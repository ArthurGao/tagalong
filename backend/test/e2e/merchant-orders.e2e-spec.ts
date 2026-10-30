import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { CancellationService } from '../../src/modules/orders/cancellation.service.js';
import { RefundProcessor } from '../../src/modules/orders/refund-processor.js';
import { RefundJob } from '../../src/modules/orders/refund.job.js';
import { queueRefund } from '../../src/modules/orders/refunds.js';
import { registerFree } from '../../src/modules/orders/reservation.js';
import { StripeClient } from '../../src/modules/stripe/stripe-client.js';
import { createTestApp, type TestApp } from './support/app.js';
import { resetDb, testPrisma } from './support/db.js';
import { createMerchant } from './support/factories.js';
import { signStripeEvent } from './support/stripe-fake.js';

const ACCOUNT = 'acct_m6_merchant';

describe('merchant order management: refunds, CSV, listing cancellation (DESIGN §8.4, §8.5, M6)', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  const http = () => request(t.app.getHttpServer());
  const as = (clerkUserId: string) => ({ authorization: `Bearer valid:${clerkUserId}` });

  async function paidListing(title = 'Cherries') {
    const merchant = await prisma.merchant.findFirstOrThrow({ where: { owner: { clerkUserId: 'user_m' } } });
    return prisma.listing.create({
      data: {
        merchantId: merchant.id,
        shortCode: randomUUID().slice(0, 8),
        title,
        description: '',
        type: 'RETAIL',
        fulfilment: 'PICKUP',
        pricing: 'PAID',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        closesAt: new Date(Date.now() + 86_400_000),
        maxQtyPerOrder: 5,
        onePerEmail: false,
        allowSelfCancel: false,
        policyText: 'No refunds after pickup',
        formFields: [{ key: 'size', label: 'Size', type: 'select', required: true, scope: 'order', options: ['S', 'M'] }],
        options: { create: [{ name: '2kg', priceCents: 3900, capacity: 100 }] },
      },
      include: { options: true },
    });
  }
  type Listing = Awaited<ReturnType<typeof paidListing>>;

  /** A paid order as checkout leaves it (sold, numbered, with a payment intent). */
  async function paidOrder(l: Listing, n: number, over: { buyerName?: string; status?: 'PAID' | 'PENDING_PAYMENT' } = {}) {
    const paid = (over.status ?? 'PAID') === 'PAID';
    const order = await prisma.order.create({
      data: {
        publicCode: `TA-${randomUUID().slice(0, 6).toUpperCase()}`,
        accessToken: randomUUID(),
        listingId: l.id,
        merchantId: l.merchantId,
        buyerName: over.buyerName ?? `Buyer ${n}`,
        buyerEmail: `b${n}@example.test`,
        buyerPhone: '021 555 0101',
        isFree: false,
        status: over.status ?? 'PAID',
        subtotalCents: 3900,
        platformFeeCents: 117,
        totalCents: 3900,
        formAnswers: { size: 'M' },
        sequenceNo: paid ? n : null,
        paidAt: paid ? new Date() : null,
        stripePaymentIntentId: paid ? `pi_${randomUUID().slice(0, 12)}` : null,
        stripeCheckoutSessionId: `cs_${randomUUID().slice(0, 12)}`,
        reservationExpiresAt: new Date(Date.now() + 1_800_000),
        items: { create: [{ optionId: l.options[0].id, quantity: 1, unitPriceCents: 3900, checkoutName: 'Fixture · item' }] },
      },
    });
    const counter = paid ? 'sold_count' : 'reserved_count';
    await prisma.$executeRawUnsafe(`UPDATE listing_option SET ${counter} = ${counter} + 1 WHERE id = '${l.options[0].id}'`);
    await prisma.$executeRawUnsafe(`UPDATE listing SET ${counter} = ${counter} + 1 WHERE id = '${l.id}'`);
    return order;
  }

  const refund = (orderId: string, amountCents: number, who = 'user_m') =>
    http().post(`/api/v1/merchants/me/orders/${orderId}/refund`).set(as(who)).send({ amountCents, reason: 'Short delivery' });
  const orderRow = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
  const listOrder = async (l: { id: string }, id: string) =>
    (await http().get(`/api/v1/merchants/me/listings/${l.id}/orders`).set(as('user_m'))).body.orders.find((o: { id: string }) => o.id === id);
  /** The refund job as its schedule would run it, `minutes` from now (past leases and backoffs). */
  const runJob = (minutes: number) => t.app.get(RefundJob).run(new Date(Date.now() + minutes * 60_000));
  /** A refund decided (row + claimed task) by a request that died before calling Stripe. */
  const decidedOnly = (orderId: string, amountCents: number) =>
    prisma.$transaction((tx) => queueRefund(tx, { orderId, amountCents, reason: 'Short delivery' }));

  function deliver(event: object) {
    const { body, signature } = signStripeEvent(event, 'whsec_test_connect');
    return http().post('/api/v1/webhooks/stripe/connect').set('content-type', 'application/json').set('stripe-signature', signature).send(body);
  }
  const chargeEvent = (type: string, object: object, account = ACCOUNT, created = Math.floor(Date.now() / 1000)) => ({
    id: `evt_${randomUUID()}`,
    object: 'event',
    type,
    account,
    created,
    data: { object },
  });

  beforeAll(async () => {
    t = await createTestApp();
    prisma = testPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await t.app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    t.stripe.reset();
    const m = await createMerchant(prisma, { clerkUserId: 'user_m' });
    await prisma.merchant.update({ where: { id: m.id }, data: { chargesEnabled: true, stripeAccountId: ACCOUNT, contactEmail: 'shop@example.test' } });
    await createMerchant(prisma, { clerkUserId: 'user_other' });
  });

  describe('refunds', () => {
    it('refunds part, then the rest; never more than the total', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      const part = await refund(o.id, 1000);
      expect(part.body).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedCents: 1000, refundableCents: 2900 });
      expect(t.stripe.refunds[0]).toMatchObject({ accountId: ACCOUNT, paymentIntentId: o.stripePaymentIntentId, amountCents: 1000 });
      expect(t.stripe.refunds[0].idempotencyKey).toMatch(/^refund:/);
      expect((await refund(o.id, 2900)).body).toMatchObject({ status: 'REFUNDED', refundedCents: 3900, refundableCents: 0 });
      const over = await refund(o.id, 1);
      expect(over.status).toBe(409);
      expect(over.body).toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
      expect(await prisma.notificationOutbox.count({ where: { type: 'ORDER_REFUNDED', recipient: 'b1@example.test' } })).toBe(2);
      expect(await prisma.refund.findMany({ where: { orderId: o.id }, orderBy: { createdAt: 'asc' } })).toEqual([
        expect.objectContaining({ amountCents: 1000, status: 'SUCCEEDED', stripeRefundId: expect.any(String) }),
        expect.objectContaining({ amountCents: 2900, status: 'SUCCEEDED' }),
      ]);
    });

    it('refuses an amount over what is left, saying how much is left', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      const res = await refund(o.id, 4000);
      expect(res.body).toMatchObject({ code: 'REFUND_EXCEEDS_TOTAL', details: { refundableCents: 3900 } });
    });

    it('two refunds at once cannot together pass the total', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      const results = await Promise.all([refund(o.id, 3000), refund(o.id, 3000)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await orderRow(o.id)).refundedCents).toBe(3000);
      expect(t.stripe.refunds).toHaveLength(1);
    });

    it('a Stripe error leaves the refund in flight, and refund.job finishes it', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      t.stripe.failRefund = true;
      const res = await refund(o.id, 1000);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'PAID', refundedCents: 0, pendingRefundCents: 1000, refundableCents: 2900, lastRefundFailed: false });
      expect(await prisma.refundTask.findFirstOrThrow({ where: { orderId: o.id } })).toMatchObject({ status: 'PENDING', attempts: 1 });
      t.stripe.failRefund = false;
      await runJob(2);
      expect(await listOrder(l, o.id)).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedCents: 1000, pendingRefundCents: 0, refundableCents: 2900 });
      expect(t.stripe.refunds).toHaveLength(1);
    });

    it('a refund that keeps failing ends FAILED: the amount is free again and the merchant is emailed', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      t.stripe.failRefund = true;
      await refund(o.id, 1000);
      for (let minutes = 2; minutes <= 60; minutes += 10) await runJob(minutes);
      expect(await prisma.refundTask.findFirstOrThrow({ where: { orderId: o.id } })).toMatchObject({ status: 'FAILED', attempts: 5 });
      expect(await listOrder(l, o.id)).toMatchObject({ status: 'PAID', refundedCents: 0, pendingRefundCents: 0, refundableCents: 3900, lastRefundFailed: true });
      expect(await prisma.notificationOutbox.findFirstOrThrow({ where: { type: 'REFUND_FAILED' } })).toMatchObject({
        recipient: 'shop@example.test',
        payload: expect.objectContaining({ publicCode: o.publicCode, amountCents: 1000 }),
      });
      t.stripe.failRefund = false;
      expect((await refund(o.id, 3900)).body).toMatchObject({ status: 'REFUNDED', lastRefundFailed: false });
    });

    it('a refund Stripe holds as pending counts only once it succeeds; one that then fails frees the amount', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      t.stripe.newRefundStatus = 'pending';
      expect((await refund(o.id, 1000)).body).toMatchObject({ status: 'PAID', refundedCents: 0, pendingRefundCents: 1000 });
      expect(await prisma.notificationOutbox.count({ where: { type: 'ORDER_REFUNDED' } })).toBe(0);
      const first = await prisma.refundTask.findFirstOrThrow({ where: { orderId: o.id } });
      expect(first).toMatchObject({ status: 'PENDING', attempts: 0, stripeRefundId: expect.any(String) });
      t.stripe.settleRefund(first.stripeRefundId!, 'succeeded');
      await runJob(16);
      expect(await orderRow(o.id)).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedCents: 1000 });

      await refund(o.id, 500);
      const second = await prisma.refundTask.findFirstOrThrow({ where: { orderId: o.id, status: 'PENDING' } });
      t.stripe.settleRefund(second.stripeRefundId!, 'failed');
      await runJob(16);
      expect(await prisma.refund.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ status: 'FAILED' });
      expect(await listOrder(l, o.id)).toMatchObject({ refundedCents: 1000, pendingRefundCents: 0, refundableCents: 2900, lastRefundFailed: true });
      expect(t.stripe.refunds).toHaveLength(2);
    });

    it('a refund decided by a request that died is resumed by refund.job, with the same key, once', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      const task = await decidedOnly(o.id, 1000);
      expect((await refund(o.id, 3000)).body.code).toBe('REFUND_EXCEEDS_TOTAL'); // still in flight
      await runJob(1); // the lease still holds it
      expect(t.stripe.refunds).toHaveLength(0);
      await runJob(6);
      expect(t.stripe.refunds).toEqual([expect.objectContaining({ amountCents: 1000, idempotencyKey: `refund:${task.id}` })]);
      expect(await orderRow(o.id)).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedCents: 1000 });
    });

    it('a worker whose lease ran out cannot overwrite what another worker recorded', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      const stale = await decidedOnly(o.id, 1000);
      await runJob(6); // another worker takes it over and succeeds
      t.stripe.failRefund = true;
      // The first worker wakes up on its last attempt and fails.
      expect(await t.app.get(RefundProcessor).process({ ...stale, attempts: 4 })).toBe('retrying');
      expect(await prisma.refundTask.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({ status: 'SUCCEEDED' });
      expect(await prisma.refund.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({ status: 'SUCCEEDED' });
      expect(await prisma.notificationOutbox.count({ where: { type: 'REFUND_FAILED' } })).toBe(0);
    });
    it("only the merchant's own paid orders can be refunded", async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      expect((await refund(o.id, 100, 'user_other')).status).toBe(404);
      const unpaid = await paidOrder(l, 2, { status: 'PENDING_PAYMENT' });
      expect((await refund(unpaid.id, 100)).body.code).toBe('INVALID_STATE_TRANSITION');
    });
  });

  describe('Stripe events', () => {
    const chargeRefunded = (o: { stripePaymentIntentId: string | null }, account = ACCOUNT) =>
      deliver(
        chargeEvent(
          'charge.refunded',
          { id: 'ch_1', object: 'charge', payment_intent: o.stripePaymentIntentId, amount_refunded: t.stripe.amountRefunded(o.stripePaymentIntentId!) },
          account,
        ),
      );

    it('charge.refunded adds only refunds made outside TagAlong, each once by its id', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      await refund(o.id, 1000); // ours
      expect((await chargeRefunded(o)).status).toBe(200); // our own refund echoed
      expect((await orderRow(o.id)).refundedCents).toBe(1000);
      const dashboard = t.stripe.dashboardRefund(ACCOUNT, o.stripePaymentIntentId!, 1500);
      await chargeRefunded(o);
      await chargeRefunded(o); // replayed
      expect(await orderRow(o.id)).toMatchObject({ refundedCents: 2500, status: 'PARTIALLY_REFUNDED' });
      expect(await prisma.refund.findUniqueOrThrow({ where: { stripeRefundId: dashboard } })).toMatchObject({ amountCents: 1500, status: 'SUCCEEDED' });
      t.stripe.dashboardRefund(ACCOUNT, o.stripePaymentIntentId!, 1400);
      await chargeRefunded(o, 'acct_someone_else');
      expect((await orderRow(o.id)).refundedCents).toBe(2500);
    });

    it('a Dashboard refund while one of ours is still in flight is not lost', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      await decidedOnly(o.id, 1500); // ours: decided, not yet at Stripe
      t.stripe.dashboardRefund(ACCOUNT, o.stripePaymentIntentId!, 2000);
      await chargeRefunded(o);
      expect((await orderRow(o.id)).refundedCents).toBe(2000);
      await runJob(6);
      expect(await orderRow(o.id)).toMatchObject({ refundedCents: 3500, status: 'PARTIALLY_REFUNDED' });
    });

    it('charge.refunded confirms our refund that Stripe held as pending', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      t.stripe.newRefundStatus = 'pending';
      await refund(o.id, 3900);
      const task = await prisma.refundTask.findFirstOrThrow({ where: { orderId: o.id } });
      t.stripe.settleRefund(task.stripeRefundId!, 'succeeded');
      await chargeRefunded(o);
      expect(await orderRow(o.id)).toMatchObject({ refundedCents: 3900, status: 'REFUNDED' });
      expect(await prisma.refundTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: 'SUCCEEDED' });
      await runJob(16); // nothing left to do, nothing counted twice
      expect((await orderRow(o.id)).refundedCents).toBe(3900);
      expect(await prisma.notificationOutbox.count({ where: { type: 'ORDER_REFUNDED' } })).toBe(1);
    });

    it('a Dashboard refund carrying one of our refund ids in its metadata is still counted for its own amount', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      t.stripe.failRefund = true;
      await refund(o.id, 1000);
      for (let minutes = 2; minutes <= 60; minutes += 10) await runJob(minutes);
      const failed = await prisma.refund.findFirstOrThrow({ where: { orderId: o.id } });
      expect(failed.status).toBe('FAILED');
      t.stripe.failRefund = false;
      t.stripe.dashboardRefund(ACCOUNT, o.stripePaymentIntentId!, 100, failed.id);
      await chargeRefunded(o);
      expect(await orderRow(o.id)).toMatchObject({ refundedCents: 100, status: 'PARTIALLY_REFUNDED' });
      expect(await prisma.refund.findUniqueOrThrow({ where: { id: failed.id } })).toMatchObject({ status: 'FAILED' });
    });

    it('a refund Stripe already holds is never given up for lack of an answer', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      t.stripe.newRefundStatus = 'pending';
      await refund(o.id, 1000);
      t.stripe.failRefund = true;
      for (let minutes = 16; minutes <= 16 * 8; minutes += 16) await runJob(minutes);
      expect(await prisma.refundTask.findFirstOrThrow({ where: { orderId: o.id } })).toMatchObject({ status: 'PENDING', lastError: expect.any(String) });
      expect(await listOrder(l, o.id)).toMatchObject({ pendingRefundCents: 1000, refundableCents: 2900, lastRefundFailed: false });
      expect(await prisma.notificationOutbox.count({ where: { type: 'REFUND_FAILED' } })).toBe(0);
    });

    it('a dispute is logged and the merchant emailed', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      const dispute = { id: 'dp_1', object: 'dispute', payment_intent: o.stripePaymentIntentId, amount: 3900, reason: 'fraudulent', status: 'needs_response' };
      expect((await deliver(chargeEvent('charge.dispute.created', dispute))).status).toBe(200);
      expect(await prisma.notificationOutbox.findFirstOrThrow({ where: { type: 'MERCHANT_DISPUTE' } })).toMatchObject({
        recipient: 'shop@example.test',
        payload: expect.objectContaining({ reason: 'fraudulent', publicCode: o.publicCode }),
      });
    });
  });

  describe('dispute records (admin console, DESIGN §8.3)', () => {
    const disputeOf = (o: { stripePaymentIntentId: string | null }, status: string) => ({
      id: 'dp_9',
      object: 'dispute',
      payment_intent: o.stripePaymentIntentId,
      amount: 3900,
      reason: 'product_not_received',
      status,
    });
    const row = () => prisma.dispute.findUniqueOrThrow({ where: { id: 'dp_9' } });

    it('follows created → updated → closed, ignores an older event, and never reopens', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      await deliver(chargeEvent('charge.dispute.created', disputeOf(o, 'needs_response'), ACCOUNT, 1_000));
      expect(await row()).toMatchObject({ orderId: o.id, merchantId: l.merchantId, status: 'needs_response', open: true, closedAt: null, amountCents: 3900 });
      await deliver(chargeEvent('charge.dispute.updated', disputeOf(o, 'under_review'), ACCOUNT, 2_000));
      expect(await row()).toMatchObject({ status: 'under_review', open: true });
      await deliver(chargeEvent('charge.dispute.closed', disputeOf(o, 'won'), ACCOUNT, 3_000));
      expect(await row()).toMatchObject({ status: 'won', open: false, closedAt: new Date(3_000_000) });
      await deliver(chargeEvent('charge.dispute.updated', disputeOf(o, 'under_review'), ACCOUNT, 2_500)); // late, older
      await deliver(chargeEvent('charge.dispute.updated', disputeOf(o, 'needs_response'), ACCOUNT, 4_000)); // never reopens
      expect(await row()).toMatchObject({ status: 'won', open: false });
      expect(await prisma.notificationOutbox.count({ where: { type: 'MERCHANT_DISPUTE' } })).toBe(1);
    });

    it('a closing event that arrives first is kept; the late creation still emails the merchant', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      await deliver(chargeEvent('charge.dispute.closed', disputeOf(o, 'lost'), ACCOUNT, 3_000));
      await deliver(chargeEvent('charge.dispute.created', disputeOf(o, 'needs_response'), ACCOUNT, 1_000));
      expect(await row()).toMatchObject({ status: 'lost', open: false });
      expect(await prisma.notificationOutbox.count({ where: { type: 'MERCHANT_DISPUTE' } })).toBe(1);
    });

    it('a newer event waiting on a concurrent first insert still wins', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      // The created event's insert is in flight (uncommitted) when the closed event arrives.
      let commit!: () => void;
      const committed = new Promise<void>((r) => (commit = r));
      let inserted = false;
      const creating = prisma.$transaction(
        async (tx) => {
          await tx.dispute.create({
            data: { id: 'dp_9', orderId: o.id, merchantId: l.merchantId, amountCents: 3900, reason: 'product_not_received', status: 'needs_response', open: true, lastEventAt: new Date(1_000_000) },
          });
          inserted = true;
          await committed;
        },
        { timeout: 20_000 },
      );
      await vi.waitFor(() => expect(inserted).toBe(true));
      const closing = deliver(chargeEvent('charge.dispute.closed', disputeOf(o, 'lost'), ACCOUNT, 3_000)).then((r) => r); // supertest sends on then
      await vi.waitFor(
        async () => {
          const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
            SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`;
          expect(waiting).toBeGreaterThan(0);
        },
        { timeout: 10_000 },
      );
      commit();
      await creating;
      expect((await closing).status).toBe(200);
      expect(await row()).toMatchObject({ status: 'lost', open: false, closedAt: new Date(3_000_000) });
    }, 30_000);

    it('a dispute of another account is ignored', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      await deliver(chargeEvent('charge.dispute.created', disputeOf(o, 'needs_response'), 'acct_someone_else'));
      expect(await prisma.dispute.count()).toBe(0);
    });
  });

  it('exports the orders as CSV with answers, safe for spreadsheets, to the owner only', async () => {
    const l = await paidListing();
    await paidOrder(l, 1, { buyerName: '=HYPERLINK("http://evil")' });
    await paidOrder(l, 2, { buyerName: '林小雨' });
    const res = await http().get(`/api/v1/merchants/me/listings/${l.id}/orders.csv`).set(as('user_m'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    const text = res.text;
    expect(text.startsWith('﻿#,Order,Status,Name,Email,Phone,Items,Total,Refunded,Pickup,Note,Time,Size')).toBe(true);
    const lines = text.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('林小雨');
    expect(lines[1]).toContain('39.00');
    expect(lines[2]).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect((await http().get(`/api/v1/merchants/me/listings/${l.id}/orders.csv`).set(as('user_other'))).status).toBe(404);
  });

  describe('cancelling a whole listing', () => {
    const cancel = (l: Listing, confirmTitle = l.title) =>
      http().post(`/api/v1/merchants/me/listings/${l.id}/cancel`).set(as('user_m')).send({ reason: 'Storm damaged the crop', confirmTitle });

    async function drain(now = new Date()) {
      // Run the job as its schedule would, moving the clock past each backoff.
      for (let i = 0; i < 40; i++) {
        const pending = await prisma.refundTask.count({ where: { status: 'PENDING' } });
        if (!pending) return;
        await t.app.get(RefundJob).run(now);
        now = new Date(now.getTime() + 10 * 60_000);
      }
      throw new Error('refunds never drained');
    }

    it('50 paid orders, Stripe failing on 5: 45 refunded, 5 FAILED after retries, then a retry succeeds', async () => {
      const l = await paidListing('Cherry run');
      const orders = [];
      for (let n = 1; n <= 50; n++) orders.push(await paidOrder(l, n));
      const unpaid = await paidOrder(l, 51, { status: 'PENDING_PAYMENT' });

      const preview = await http().get(`/api/v1/merchants/me/listings/${l.id}/cancellation/preview`).set(as('user_m'));
      expect(preview.body).toEqual({ paidOrders: 50, refundTotalCents: 50 * 3900, registrations: 0, unpaidOrders: 1 });
      expect((await cancel(l, 'Wrong title')).body.code).toBe('VALIDATION_FAILED');

      const started = await cancel(l);
      expect(started.body).toMatchObject({ status: 'RUNNING', totalOrders: 50, pending: 50 });
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: l.id } })).status).toBe('CANCELLED');
      expect((await orderRow(unpaid.id)).status).toBe('EXPIRED');
      expect(t.stripe.expired.map((e) => e.sessionId)).toEqual([unpaid.stripeCheckoutSessionId]);

      const tasks = await prisma.refundTask.findMany({ orderBy: { createdAt: 'asc' } });
      for (const task of tasks.slice(0, 5)) t.stripe.failRefundKeys.add(task.id);
      await drain();

      const progress = await http().get(`/api/v1/merchants/me/listings/${l.id}/cancellation`).set(as('user_m'));
      expect(progress.body).toMatchObject({ status: 'COMPLETED_WITH_FAILURES', succeeded: 45, failed: 5, pending: 0 });
      expect(await prisma.refundTask.findMany({ where: { status: 'FAILED' } })).toHaveLength(5);
      expect((await prisma.refundTask.findFirstOrThrow({ where: { status: 'FAILED' } })).attempts).toBe(5);
      expect(await prisma.order.count({ where: { listingId: l.id, status: 'REFUNDED' } })).toBe(45);
      // RefundTask.id is the idempotency key: every Stripe refund used one, and none twice.
      const keys = t.stripe.refunds.map((r) => r.idempotencyKey);
      expect(new Set(keys).size).toBe(45);
      expect(await prisma.notificationOutbox.findFirstOrThrow({ where: { type: 'CANCELLATION_FINISHED' } })).toMatchObject({
        recipient: 'shop@example.test',
        payload: { listingTitle: 'Cherry run', succeeded: 45, failed: 5 },
      });

      t.stripe.failRefundKeys.clear();
      const cancellation = await prisma.listingCancellation.findFirstOrThrow({ where: { listingId: l.id } });
      expect(await t.app.get(CancellationService).retryFailed(cancellation.id)).toBe(5);
      await drain();
      expect(await prisma.listingCancellation.findFirstOrThrow({ where: { listingId: l.id } })).toMatchObject({
        status: 'COMPLETED',
        succeeded: 50,
        failed: 0,
      });
      expect(await prisma.order.count({ where: { listingId: l.id, status: 'REFUNDED' } })).toBe(50);
      expect(await prisma.notificationOutbox.count({ where: { type: 'ORDER_REFUNDED' } })).toBe(50);
    }, 60_000);

    it('a refund already in flight when the listing is cancelled keeps the cancellation running until it settles', async () => {
      const l = await paidListing('Cherry run');
      const o = await paidOrder(l, 1);
      t.stripe.failRefund = true;
      expect((await refund(o.id, 1500)).status).toBe(200); // Stripe down: the merchant's refund stays in flight
      t.stripe.failRefund = false;
      const [single] = await prisma.refundTask.findMany();
      t.stripe.failRefundKeys.add(single.id); // and it will end up failing

      const started = await cancel(l);
      expect(started.body).toMatchObject({ status: 'RUNNING', totalOrders: 1 });
      expect(await prisma.refundTask.findFirstOrThrow({ where: { cancellationId: { not: null } } })).toMatchObject({ amountCents: 3900 - 1500 });

      await t.app.get(RefundJob).run(new Date(Date.now() + 10 * 60_000));
      // The cancellation's own refund is done, the merchant's earlier one is still being retried: not finished yet.
      expect(await prisma.refundTask.findUniqueOrThrow({ where: { id: single.id } })).toMatchObject({ status: 'PENDING' });
      expect(await prisma.listingCancellation.findFirstOrThrow({ where: { listingId: l.id } })).toMatchObject({ status: 'RUNNING', succeeded: 1 });
      expect(await prisma.notificationOutbox.count({ where: { type: 'CANCELLATION_FINISHED' } })).toBe(0);

      await drain(new Date(Date.now() + 20 * 60_000));
      expect(await prisma.refundTask.findUniqueOrThrow({ where: { id: single.id } })).toMatchObject({ status: 'FAILED' });
      expect(await prisma.listingCancellation.findFirstOrThrow({ where: { listingId: l.id } })).toMatchObject({ status: 'COMPLETED', succeeded: 1, failed: 0 });
      expect(await prisma.notificationOutbox.count({ where: { type: 'CANCELLATION_FINISHED' } })).toBe(1);
      expect(await prisma.notificationOutbox.count({ where: { type: 'REFUND_FAILED' } })).toBe(1); // the merchant hears of that one
    });

    it('an order created while the cancellation waits for the listing is cancelled too', async () => {
      const merchant = await prisma.merchant.findFirstOrThrow({ where: { owner: { clerkUserId: 'user_m' } } });
      const l = await prisma.listing.create({
        data: {
          merchantId: merchant.id, shortCode: randomUUID().slice(0, 8), title: 'Talk', description: '', type: 'EVENT', fulfilment: 'ONSITE',
          pricing: 'FREE', status: 'PUBLISHED', publishedAt: new Date(), closesAt: new Date(Date.now() + 86_400_000), maxQtyPerOrder: 1,
          onePerEmail: true, allowSelfCancel: true, policyText: 'x', options: { create: [{ name: 'Seat', priceCents: 0, capacity: 5 }] },
        },
        include: { options: true },
      });
      // A registration holds the listing (as registerFree does) while the cancellation scans the orders.
      let holding!: () => void;
      const held = new Promise<void>((resolve) => (holding = resolve));
      const registration = prisma.$transaction(async (tx) => {
        const seq = await registerFree(tx, l.id, [{ optionId: l.options[0].id, quantity: 1 }]);
        holding();
        await new Promise((resolve) => setTimeout(resolve, 300));
        await tx.order.create({
          data: {
            publicCode: 'TA-RACE01', accessToken: randomUUID(), listingId: l.id, merchantId: merchant.id, buyerName: 'Amy', buyerEmail: 'amy@example.test',
            buyerPhone: '021', isFree: true, onePerEmail: true, status: 'CONFIRMED', sequenceNo: seq, subtotalCents: 0, platformFeeCents: 0, totalCents: 0,
            items: { create: [{ optionId: l.options[0].id, quantity: 1, unitPriceCents: 0, checkoutName: 'Fixture · item' }] },
          },
        });
      });
      await held;
      const [res] = await Promise.all([cancel(l), registration]);
      expect(res.body).toMatchObject({ status: 'COMPLETED' });
      expect((await prisma.order.findUniqueOrThrow({ where: { publicCode: 'TA-RACE01' } })).status).toBe('CANCELLED');
      expect(await prisma.listingOption.findUniqueOrThrow({ where: { id: l.options[0].id } })).toMatchObject({ soldCount: 0 });
      expect(await prisma.notificationOutbox.count({ where: { type: 'REGISTRATION_CANCELLED', recipient: 'amy@example.test' } })).toBe(1);
    });

    it('a payment that lands after the listing was cancelled is refunded, never sold', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1, { status: 'PENDING_PAYMENT' });
      await cancel(l);
      expect((await orderRow(o.id)).status).toBe('EXPIRED');
      const session = {
        id: o.stripeCheckoutSessionId, object: 'checkout.session', payment_status: 'paid', status: 'complete', amount_total: 3900,
        currency: 'nzd', payment_intent: 'pi_late_after_cancel', metadata: { orderId: o.id },
      };
      expect((await deliver(chargeEvent('checkout.session.completed', session))).status).toBe(200);
      expect(await orderRow(o.id)).toMatchObject({ status: 'EXPIRED', refundedCents: 3900, sequenceNo: null });
      expect(t.stripe.refunds).toEqual([expect.objectContaining({ paymentIntentId: 'pi_late_after_cancel', amountCents: 3900 })]);
      expect(await prisma.notificationOutbox.count({ where: { type: 'ORDER_CONFIRMED' } })).toBe(0);
      expect(await prisma.notificationOutbox.count({ where: { type: 'ORDER_AUTO_REFUNDED', recipient: 'b1@example.test' } })).toBe(1);
      expect(await prisma.listingOption.findUniqueOrThrow({ where: { id: l.options[0].id } })).toMatchObject({ soldCount: 0, reservedCount: 0 });
    });

    it('a cancellation whose last refund was settled by a run that then died is still finished', async () => {
      const l = await paidListing();
      await paidOrder(l, 1);
      await cancel(l);
      const task = await prisma.refundTask.findFirstOrThrow();
      // That run settled the task, then died before finishing the cancellation.
      await prisma.$transaction(async (tx) => {
        await tx.refundTask.update({ where: { id: task.id }, data: { status: 'SUCCEEDED' } });
        await tx.refund.update({ where: { id: task.id }, data: { status: 'SUCCEEDED' } });
        await tx.listingCancellation.update({ where: { id: task.cancellationId! }, data: { succeeded: 1 } });
      });
      expect((await prisma.listingCancellation.findFirstOrThrow()).status).toBe('RUNNING');
      expect(await runJob(1)).toEqual({ succeeded: 0, waiting: 0, retrying: 0, failed: 0 }); // nothing to claim
      expect(await prisma.listingCancellation.findFirstOrThrow()).toMatchObject({ status: 'COMPLETED', succeeded: 1 });
      expect(await prisma.notificationOutbox.count({ where: { type: 'CANCELLATION_FINISHED' } })).toBe(1);
    });

    it('a retry gives a refund Stripe refused a new id, and resends one that only met errors under its own', async () => {
      const l = await paidListing();
      const refused = await paidOrder(l, 1);
      const unanswered = await paidOrder(l, 2);
      await cancel(l);
      const tasks = await prisma.refundTask.findMany();
      const refusedTask = tasks.find((x) => x.orderId === refused.id)!;
      const unansweredTask = tasks.find((x) => x.orderId === unanswered.id)!;
      t.stripe.failRefundKeys.add(unansweredTask.id);
      t.stripe.newRefundStatus = 'failed';
      await drain();
      expect(await prisma.listingCancellation.findFirstOrThrow()).toMatchObject({ status: 'COMPLETED_WITH_FAILURES', failed: 2 });

      t.stripe.failRefundKeys.clear();
      t.stripe.newRefundStatus = 'succeeded';
      const cancellation = await prisma.listingCancellation.findFirstOrThrow();
      expect(await t.app.get(CancellationService).retryFailed(cancellation.id)).toBe(2);
      await drain();
      expect(await prisma.listingCancellation.findFirstOrThrow()).toMatchObject({ status: 'COMPLETED', succeeded: 2, failed: 0 });
      expect(await prisma.order.count({ where: { status: 'REFUNDED' } })).toBe(2);
      // The refused refund stays on record; its retry is a new refund. The other kept its id (and key).
      expect(await prisma.refund.findUniqueOrThrow({ where: { id: refusedTask.id } })).toMatchObject({ status: 'FAILED' });
      expect(await prisma.refund.findFirstOrThrow({ where: { orderId: refused.id, status: 'SUCCEEDED' } })).not.toMatchObject({ id: refusedTask.id });
      expect(await prisma.refund.findUniqueOrThrow({ where: { id: unansweredTask.id } })).toMatchObject({ status: 'SUCCEEDED' });
    });

    it('a refund Stripe made although we gave up on it completes the cancellation when it is reported', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      await cancel(l);
      const task = await prisma.refundTask.findFirstOrThrow();
      t.stripe.failRefund = true;
      await drain();
      expect(await prisma.listingCancellation.findFirstOrThrow()).toMatchObject({ status: 'COMPLETED_WITH_FAILURES', failed: 1 });
      t.stripe.failRefund = false;
      // One of those attempts did reach Stripe after all.
      t.stripe.keysExpired = true;
      await t.app.get(StripeClient).refundPayment(ACCOUNT, o.stripePaymentIntentId!, 3900, task.id);
      await deliver(
        chargeEvent('charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: o.stripePaymentIntentId, amount_refunded: 3900 }),
      );
      expect(await orderRow(o.id)).toMatchObject({ status: 'REFUNDED', refundedCents: 3900 });
      expect(await prisma.listingCancellation.findFirstOrThrow()).toMatchObject({ status: 'COMPLETED', succeeded: 1, failed: 0 });
    });

    it('a task older than Stripe keeps its idempotency key looks for its refund before making one', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      const task = await decidedOnly(o.id, 1000);
      // The request that decided it did reach Stripe a day ago, then died; the key has expired since.
      await t.app.get(StripeClient).refundPayment(ACCOUNT, o.stripePaymentIntentId!, 1000, task.id);
      t.stripe.keysExpired = true;
      await prisma.refundTask.update({ where: { id: task.id }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
      await runJob(6);
      expect(t.stripe.refunds).toHaveLength(1);
      expect(await orderRow(o.id)).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedCents: 1000 });
    });

    it('a free listing is cancelled at once: registrations cancelled and told why', async () => {
      const merchant = await prisma.merchant.findFirstOrThrow({ where: { owner: { clerkUserId: 'user_m' } } });
      const l = await prisma.listing.create({
        data: {
          merchantId: merchant.id, shortCode: randomUUID().slice(0, 8), title: 'Talk', description: '', type: 'EVENT', fulfilment: 'ONSITE',
          pricing: 'FREE', status: 'CLOSED', maxQtyPerOrder: 1, onePerEmail: true, allowSelfCancel: true, policyText: 'x',
          options: { create: [{ name: 'Seat', priceCents: 0, capacity: 5, soldCount: 1 }] }, soldCount: 1,
        },
        include: { options: true },
      });
      await prisma.order.create({
        data: {
          publicCode: 'TA-FREE01', accessToken: randomUUID(), listingId: l.id, merchantId: merchant.id, buyerName: 'Amy', buyerEmail: 'amy@example.test',
          buyerPhone: '021', isFree: true, onePerEmail: true, status: 'CONFIRMED', sequenceNo: 1, subtotalCents: 0, platformFeeCents: 0, totalCents: 0,
          items: { create: [{ optionId: l.options[0].id, quantity: 1, unitPriceCents: 0, checkoutName: 'Fixture · item' }] },
        },
      });
      expect((await cancel(l)).body).toMatchObject({ status: 'COMPLETED', totalOrders: 0 });
      expect((await prisma.order.findUniqueOrThrow({ where: { publicCode: 'TA-FREE01' } })).status).toBe('CANCELLED');
      expect(await prisma.notificationOutbox.findFirstOrThrow({ where: { type: 'REGISTRATION_CANCELLED' } })).toMatchObject({
        payload: expect.objectContaining({ reason: 'Storm damaged the crop' }),
      });
      expect((await cancel(l)).body.code).toBe('INVALID_STATE_TRANSITION');
    });
  });
});
