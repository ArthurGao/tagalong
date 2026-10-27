import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { CancellationService } from '../../src/modules/orders/cancellation.service.js';
import { RefundJob } from '../../src/modules/orders/refund.job.js';
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
        items: { create: [{ optionId: l.options[0].id, quantity: 1, unitPriceCents: 3900 }] },
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

  function deliver(event: object) {
    const { body, signature } = signStripeEvent(event, 'whsec_test_connect');
    return http().post('/api/v1/webhooks/stripe/connect').set('content-type', 'application/json').set('stripe-signature', signature).send(body);
  }
  const chargeEvent = (type: string, object: object, account = ACCOUNT) => ({ id: `evt_${randomUUID()}`, object: 'event', type, account, data: { object } });

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

    it('a Stripe failure refunds nothing and frees the amount again', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      t.stripe.failRefund = true;
      expect((await refund(o.id, 1000)).body.code).toBe('STRIPE_ERROR');
      expect(await orderRow(o.id)).toMatchObject({ status: 'PAID', refundedCents: 0 });
      expect(await prisma.refund.findFirstOrThrow({ where: { orderId: o.id } })).toMatchObject({ status: 'FAILED' });
      t.stripe.failRefund = false;
      expect((await refund(o.id, 3900)).body.status).toBe('REFUNDED');
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
    it('charge.refunded adds only refunds made outside TagAlong, once', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      await refund(o.id, 1000); // ours
      const charge = (refunded: number) => ({ id: 'ch_1', object: 'charge', payment_intent: o.stripePaymentIntentId, amount_refunded: refunded });
      expect((await deliver(chargeEvent('charge.refunded', charge(1000)))).status).toBe(200); // our own refund echoed
      expect((await orderRow(o.id)).refundedCents).toBe(1000);
      await deliver(chargeEvent('charge.refunded', charge(2500))); // +1500 in the Dashboard
      await deliver(chargeEvent('charge.refunded', charge(2500))); // replayed
      expect(await orderRow(o.id)).toMatchObject({ refundedCents: 2500, status: 'PARTIALLY_REFUNDED' });
      await deliver(chargeEvent('charge.refunded', charge(2500), 'acct_someone_else'));
      await deliver(chargeEvent('charge.refunded', charge(3900), 'acct_someone_else'));
      expect((await orderRow(o.id)).refundedCents).toBe(2500);
    });

    it('a dispute is logged and the merchant emailed', async () => {
      const l = await paidListing();
      const o = await paidOrder(l, 1);
      const dispute = { id: 'dp_1', object: 'dispute', payment_intent: o.stripePaymentIntentId, amount: 3900, reason: 'fraudulent' };
      expect((await deliver(chargeEvent('charge.dispute.created', dispute))).status).toBe(200);
      expect(await prisma.notificationOutbox.findFirstOrThrow({ where: { type: 'MERCHANT_DISPUTE' } })).toMatchObject({
        recipient: 'shop@example.test',
        payload: expect.objectContaining({ reason: 'fraudulent', publicCode: o.publicCode }),
      });
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
          items: { create: [{ optionId: l.options[0].id, quantity: 1, unitPriceCents: 0 }] },
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
