import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { OutboxJob } from '../../src/modules/notifications/outbox.job.js';
import { ExpiryJob } from '../../src/modules/orders/expiry.job.js';
import { createTestApp, type TestApp } from './support/app.js';
import { resetDb, testPrisma } from './support/db.js';
import { createMerchant } from './support/factories.js';
import { signStripeEvent } from './support/stripe-fake.js';

const ORIGIN = 'http://localhost:3800';
const ACCOUNT = 'acct_test_merchant';

describe('paid ordering (DESIGN §6, §7, §8.2, §8.3, §12, M5)', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  const http = () => request(t.app.getHttpServer());

  interface ListingSetup {
    capacities?: (number | null)[];
    prices?: number[];
    totalCapacity?: number | null;
    maxQtyPerOrder?: number;
    status?: 'PUBLISHED' | 'CLOSED';
    chargesEnabled?: boolean;
    merchantStatus?: 'ACTIVE' | 'SUSPENDED';
    pricing?: 'PAID' | 'FREE';
  }

  async function listing(s: ListingSetup = {}) {
    const merchant = await createMerchant(prisma, { status: s.merchantStatus ?? 'ACTIVE' });
    await prisma.merchant.update({
      where: { id: merchant.id },
      data: { chargesEnabled: s.chargesEnabled ?? true, stripeAccountId: `${ACCOUNT}_${merchant.id.slice(-6)}` },
    });
    const capacities = s.capacities ?? [5];
    return prisma.listing.create({
      data: {
        merchantId: merchant.id,
        shortCode: randomUUID().slice(0, 8),
        title: 'Cherries',
        description: '',
        type: 'RETAIL',
        fulfilment: 'PICKUP',
        pricing: s.pricing ?? 'PAID',
        status: s.status ?? 'PUBLISHED',
        publishedAt: new Date(),
        closesAt: new Date(Date.now() + 86_400_000),
        maxQtyPerOrder: s.maxQtyPerOrder ?? 5,
        onePerEmail: false,
        allowSelfCancel: false,
        policyText: 'No refunds after pickup',
        totalCapacity: s.totalCapacity ?? null,
        options: {
          create: capacities.map((capacity, i) => ({ name: `${i + 2}kg`, priceCents: s.prices?.[i] ?? 3900, capacity, sortOrder: i })),
        },
        pickupPoints: { create: [{ label: 'Albany', address: '1 Main St' }] },
      },
      include: { options: { orderBy: { sortOrder: 'asc' } }, pickupPoints: true, merchant: true },
    });
  }
  type Listing = Awaited<ReturnType<typeof listing>>;

  const body = (l: Listing, over: Record<string, unknown> = {}) => ({
    items: [{ optionId: l.options[0].id, quantity: 1 }],
    buyer: { name: 'Amy Lee', email: 'amy@example.test', phone: '021 555 0101' },
    pickupPointId: l.pickupPoints[0].id,
    anonymous: false,
    ...over,
  });

  const order = (l: Listing, over: Record<string, unknown> = {}, key: string | null = randomUUID()) => {
    const req = http().post(`/api/v1/public/listings/${l.shortCode}/orders`).set('Origin', ORIGIN);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body(l, over));
  };

  const buyer = (n: number) => ({ name: `Buyer ${n}`, email: `b${n}@example.test`, phone: '021 555 0101' });

  const counts = async (l: Listing) => {
    const options = await prisma.listingOption.findMany({ where: { listingId: l.id }, orderBy: { sortOrder: 'asc' } });
    const row = await prisma.listing.findUniqueOrThrow({ where: { id: l.id } });
    return {
      options: options.map((o) => ({ sold: o.soldCount, reserved: o.reservedCount })),
      listing: { sold: row.soldCount, reserved: row.reservedCount, seq: row.paidSeq },
    };
  };

  function deliver(event: object) {
    const { body: raw, signature } = signStripeEvent(event, 'whsec_test_connect');
    return http()
      .post('/api/v1/webhooks/stripe/connect')
      .set('content-type', 'application/json')
      .set('stripe-signature', signature)
      .send(raw);
  }

  type PlacedOrder = { id: string; stripeCheckoutSessionId: string | null; totalCents: number; merchantId: string };

  /** A Checkout event as Stripe sends it for this order's own session, account and amount. */
  async function sessionEvent(type: string, o: PlacedOrder, over: Record<string, unknown> = {}) {
    const { stripeAccountId } = await prisma.merchant.findUniqueOrThrow({ where: { id: o.merchantId } });
    const { account = stripeAccountId, ...session } = over;
    return {
      id: `evt_${randomUUID()}`,
      object: 'event',
      type,
      account,
      data: {
        object: {
          id: o.stripeCheckoutSessionId,
          object: 'checkout.session',
          payment_status: type === 'checkout.session.completed' ? 'paid' : 'unpaid',
          payment_intent: type === 'checkout.session.completed' ? `pi_${o.id.slice(-8)}` : null,
          amount_total: o.totalCents,
          currency: 'nzd',
          metadata: { orderId: o.id },
          ...session,
        },
      },
    };
  }

  /** Places an order and returns its row (with the Checkout session id the fake issued). */
  async function placed(l: Listing, over: Record<string, unknown> = {}) {
    const res = await order(l, over);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.checkoutUrl.split('/').pop();
    return prisma.order.findUniqueOrThrow({ where: { stripeCheckoutSessionId: id }, include: { items: true } });
  }

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
    t.email.reset();
  });

  describe('placing an order', () => {
    it('holds the places and opens Checkout with database prices, the platform fee and the reservation deadline', async () => {
      const l = await listing({ capacities: [5, null], prices: [3900, 5900] });
      const before = Date.now();
      const res = await order(l, {
        items: [
          { optionId: l.options[0].id, quantity: 2 },
          { optionId: l.options[1].id, quantity: 1 },
        ],
        locale: 'en',
      });
      expect(res.status).toBe(201);
      expect(res.body.kind).toBe('checkout');

      const [session] = t.stripe.sessions;
      expect(session.accountId).toBe(l.merchant.stripeAccountId);
      expect(session.lines).toEqual([
        { name: 'Cherries · 2kg', unitAmountCents: 3900, quantity: 2 },
        { name: 'Cherries · 3kg', unitAmountCents: 5900, quantity: 1 },
      ]);
      expect(session.applicationFeeCents).toBe(411); // 3% of 13700
      expect(session.expiresAt.getTime() - before).toBeGreaterThanOrEqual(30 * 60_000 - 1000);
      expect(session.expiresAt.getTime() - before).toBeLessThan(31 * 60_000);

      const row = await prisma.order.findFirstOrThrow({ where: { listingId: l.id } });
      expect(res.body.checkoutUrl).toBe(`https://checkout.stripe.test/${row.stripeCheckoutSessionId}`);
      expect(session.successUrl).toBe(`${ORIGIN}/en/o/${row.publicCode}?t=${row.accessToken}&paid=1`);
      expect(session.cancelUrl).toBe(`${ORIGIN}/en/l/${l.shortCode}`);
      expect(row).toMatchObject({
        status: 'PENDING_PAYMENT',
        subtotalCents: 13700,
        platformFeeCents: 411,
        totalCents: 13700,
        isFree: false,
        locale: 'en',
        sequenceNo: null,
      });
      expect(await counts(l)).toEqual({
        options: [
          { sold: 0, reserved: 2 },
          { sold: 0, reserved: 1 },
        ],
        listing: { sold: 0, reserved: 3, seq: 0 },
      });
    });

    it('never accepts a price from the client', async () => {
      const l = await listing();
      const res = await order(l, { items: [{ optionId: l.options[0].id, quantity: 1, unitPriceCents: 1 }] });
      expect(res.status).toBe(400);
      expect(await prisma.order.count()).toBe(0);
    });

    it('capacity 5, 50 parallel orders: exactly 5 succeed and the counters never pass capacity', async () => {
      const l = await listing({ capacities: [5] });
      const results = await Promise.all(Array.from({ length: 50 }, (_, n) => order(l, { buyer: buyer(n) })));
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(5);
      expect(statuses.filter((s) => s === 409)).toHaveLength(45);
      expect(new Set(results.filter((r) => r.status === 409).map((r) => r.body.code))).toEqual(new Set(['SOLD_OUT']));
      expect(await prisma.order.count({ where: { status: 'PENDING_PAYMENT' } })).toBe(5);
      expect(await counts(l)).toEqual({ options: [{ sold: 0, reserved: 5 }], listing: { sold: 0, reserved: 5, seq: 0 } });
    });

    it('totalCapacity 10 across two options, 50 parallel orders: exactly 10 places held', async () => {
      const l = await listing({ capacities: [10, 10], totalCapacity: 10 });
      const results = await Promise.all(
        Array.from({ length: 50 }, (_, n) =>
          order(l, { buyer: buyer(n), items: [{ optionId: l.options[n % 2].id, quantity: 1 }] }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(10);
      // Turned away by the conditional UPDATE (409), not by the CHECK constraint backstop (500).
      expect(results.filter((r) => r.status !== 201).every((r) => r.status === 409 && r.body.code === 'SOLD_OUT')).toBe(true);
      const c = await counts(l);
      expect(c.listing.reserved).toBe(10);
      expect(c.options.reduce((sum, o) => sum + o.reserved, 0)).toBe(10);
    });

    it('the same Idempotency-Key twice creates one order and answers the same', async () => {
      const l = await listing();
      const key = randomUUID();
      const first = await order(l, {}, key);
      const again = await order(l, {}, key);
      expect(again.status).toBe(201);
      expect(again.body).toEqual(first.body);
      expect(await prisma.order.count()).toBe(1);
      expect((await counts(l)).listing.reserved).toBe(1);
    });

    it('concurrent submits with one Idempotency-Key still create one order', async () => {
      const l = await listing();
      const key = randomUUID();
      const results = await Promise.all(Array.from({ length: 5 }, () => order(l, {}, key)));
      expect(await prisma.order.count()).toBe(1);
      const urls = new Set(results.filter((r) => r.status === 201).map((r) => r.body.checkoutUrl));
      expect(urls.size).toBe(1);
      // A request racing the first one's Checkout call is told to retry, never given a second order.
      for (const r of results) expect([201, 400]).toContain(r.status);
      expect((await counts(l)).listing.reserved).toBe(1);
    });

    it('a retry that arrives while the first request is still opening Checkout is told to try again', async () => {
      const l = await listing();
      const key = randomUUID();
      const first = await placed(l);
      await prisma.order.update({ where: { id: first.id }, data: { idempotencyKey: key, stripeCheckoutSessionId: null } });
      const res = await order(l, {}, key);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ORDER_IN_PROGRESS');
      expect(await prisma.order.count()).toBe(1);
    });

    it('a resubmit by the same email ends the earlier unpaid order and gives its places back', async () => {
      const l = await listing({ capacities: [3] });
      const first = await placed(l, { items: [{ optionId: l.options[0].id, quantity: 2 }] });
      const second = await placed(l, { buyer: { name: 'Amy', email: 'AMY@example.test', phone: '021 555 0101' } });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('EXPIRED');
      expect(second.status).toBe('PENDING_PAYMENT');
      expect(t.stripe.expired).toEqual([{ accountId: l.merchant.stripeAccountId, sessionId: first.stripeCheckoutSessionId }]);
      expect(await counts(l)).toMatchObject({ options: [{ sold: 0, reserved: 1 }], listing: { reserved: 1 } });
    });

    it.each([
      ['an unknown option', () => ({ items: [{ optionId: randomUUID(), quantity: 1 }] }), 400, 'VALIDATION_FAILED'],
      ['more than maxQtyPerOrder', (l: Listing) => ({ items: [{ optionId: l.options[0].id, quantity: 6 }] }), 409, 'QTY_EXCEEDS_LIMIT'],
      ['no pickup point', () => ({ pickupPointId: undefined }), 400, 'VALIDATION_FAILED'],
      ['another listing\'s pickup point', () => ({ pickupPointId: randomUUID() }), 400, 'VALIDATION_FAILED'],
      ['a bad phone number', () => ({ buyer: { name: 'A', email: 'a@example.test', phone: 'call me' } }), 400, 'VALIDATION_FAILED'],
    ])('rejects %s', async (_, over, status, code) => {
      const l = await listing();
      const res = await order(l, over(l));
      expect(res.status).toBe(status);
      expect(res.body.code).toBe(code);
      expect(await prisma.order.count()).toBe(0);
      expect((await counts(l)).listing.reserved).toBe(0);
    });

    it.each([
      ['a closed listing', { status: 'CLOSED' as const }, 'LISTING_CLOSED'],
      ['a suspended merchant', { merchantStatus: 'SUSPENDED' as const }, 'MERCHANT_SUSPENDED'],
      ['a merchant who cannot take payments', { chargesEnabled: false }, 'MERCHANT_NOT_CHARGEABLE'],
      ['a sold-out listing', { capacities: [0] }, 'SOLD_OUT'],
      ['a free listing (M5b)', { pricing: 'FREE' as const }, 'BAD_REQUEST'],
    ])('refuses %s', async (_, setup, code) => {
      const l = await listing(setup);
      const res = await order(l);
      expect(res.body.code).toBe(code);
      expect(await prisma.order.count()).toBe(0);
    });

    it('requires an Idempotency-Key and a same-site Origin', async () => {
      const l = await listing();
      expect((await order(l, {}, null)).body.code).toBe('VALIDATION_FAILED');
      const noOrigin = await http()
        .post(`/api/v1/public/listings/${l.shortCode}/orders`)
        .set('Idempotency-Key', randomUUID())
        .send(body(l));
      expect(noOrigin.status).toBe(403);
      expect(await prisma.order.count()).toBe(0);
    });

    it('when Stripe fails, the order expires, the places come back and a retry with the same key starts afresh', async () => {
      const l = await listing({ capacities: [1] });
      const key = randomUUID();
      t.stripe.failCheckout = true;
      const failed = await order(l, {}, key);
      expect(failed.status).toBe(502);
      expect(failed.body.code).toBe('STRIPE_ERROR');
      const expired = await prisma.order.findFirstOrThrow();
      expect(expired).toMatchObject({ status: 'EXPIRED', idempotencyKey: null });
      expect((await counts(l)).options).toEqual([{ sold: 0, reserved: 0 }]);

      t.stripe.failCheckout = false;
      const retried = await order(l, {}, key);
      expect(retried.status).toBe(201);
      expect(await prisma.order.count({ where: { status: 'PENDING_PAYMENT', idempotencyKey: key } })).toBe(1);
    });
  });

  describe('payment webhooks', () => {
    it('checkout.session.completed marks the order PAID, numbers it and queues one confirmation, even when replayed', async () => {
      const l = await listing({ capacities: [5] });
      const o = await placed(l, { items: [{ optionId: l.options[0].id, quantity: 2 }] });
      const event = await sessionEvent('checkout.session.completed', o);
      expect((await deliver(event)).status).toBe(200);
      expect((await deliver(event)).status).toBe(200); // same event again
      expect((await deliver({ ...event, id: `evt_${randomUUID()}` })).status).toBe(200); // Stripe resends as a new event

      const paid = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
      expect(paid).toMatchObject({ status: 'PAID', sequenceNo: 1, stripePaymentIntentId: `pi_${o.id.slice(-8)}` });
      expect(paid.paidAt).not.toBeNull();
      expect(await counts(l)).toEqual({ options: [{ sold: 2, reserved: 0 }], listing: { sold: 2, reserved: 0, seq: 1 } });
      const outbox = await prisma.notificationOutbox.findMany();
      expect(outbox).toHaveLength(1);
      expect(outbox[0]).toMatchObject({ type: 'ORDER_CONFIRMED', recipient: 'amy@example.test', dedupeKey: `ORDER_CONFIRMED:${o.id}`, status: 'PENDING' });
      expect(outbox[0].payload).toMatchObject({ seq: 1, totalCents: 7800, pickup: { label: 'Albany', address: '1 Main St' } });
    });

    it.each([
      ['another merchant\'s account', { account: 'acct_someone_else' }],
      ['no connected account (platform event)', { account: undefined }],
      ['a different Checkout session', { id: 'cs_test_other' }],
      ['a different amount', { amount_total: 100 }],
      ['another currency', { currency: 'aud' }],
    ])('ignores a completed event with %s: the order stays unpaid', async (_, over) => {
      const l = await listing();
      const o = await placed(l);
      const event = await sessionEvent('checkout.session.completed', o, over);
      if ('account' in over && over.account === undefined) delete (event as { account?: string }).account;
      expect((await deliver(event)).status).toBe(200);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('PENDING_PAYMENT');
      expect(await counts(l)).toMatchObject({ options: [{ sold: 0, reserved: 1 }] });
      expect(await prisma.notificationOutbox.count()).toBe(0);
    });

    it('ignores an expired event from another account: the places stay held', async () => {
      const l = await listing();
      const o = await placed(l);
      expect((await deliver(await sessionEvent('checkout.session.expired', o, { account: 'acct_someone_else' }))).status).toBe(200);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('PENDING_PAYMENT');
      expect(await counts(l)).toMatchObject({ options: [{ sold: 0, reserved: 1 }] });
    });

    it('an expired event arriving after the payment leaves the order PAID', async () => {
      const l = await listing();
      const o = await placed(l);
      expect((await deliver(await sessionEvent('checkout.session.completed', o))).status).toBe(200);
      expect((await deliver(await sessionEvent('checkout.session.expired', o))).status).toBe(200);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('PAID');
      expect(await counts(l)).toMatchObject({ options: [{ sold: 1, reserved: 0 }] });
    });

    it('checkout.session.expired on an unpaid order expires it and frees the places', async () => {
      const l = await listing();
      const o = await placed(l);
      await deliver(await sessionEvent('checkout.session.expired', o));
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('EXPIRED');
      expect(await counts(l)).toMatchObject({ options: [{ sold: 0, reserved: 0 }] });
    });

    it('a payment after expiry takes the places again when they are still free (§7.5)', async () => {
      const l = await listing({ capacities: [2] });
      const o = await placed(l);
      await prisma.order.update({ where: { id: o.id }, data: { reservationExpiresAt: new Date(Date.now() - 1000) } });
      await t.app.get(ExpiryJob).expireDue();
      await deliver(await sessionEvent('checkout.session.completed', o));
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('PAID');
      expect(await counts(l)).toEqual({ options: [{ sold: 1, reserved: 0 }], listing: { sold: 1, reserved: 0, seq: 1 } });
      expect(t.stripe.refunds).toEqual([]);
    });

    it('a payment after expiry on a sold-out listing is refunded in full, once, and the buyer is told (§7.5)', async () => {
      const l = await listing({ capacities: [1] });
      const late = await placed(l);
      await prisma.order.update({ where: { id: late.id }, data: { reservationExpiresAt: new Date(Date.now() - 1000) } });
      await t.app.get(ExpiryJob).expireDue();
      const other = await placed(l, { buyer: buyer(2) });
      await deliver(await sessionEvent('checkout.session.completed', other));

      const event = await sessionEvent('checkout.session.completed', late);
      expect((await deliver(event)).status).toBe(200);
      expect((await deliver({ ...event, id: `evt_${randomUUID()}` })).status).toBe(200);

      expect(t.stripe.refunds).toEqual([
        { accountId: l.merchant.stripeAccountId, paymentIntentId: `pi_${late.id.slice(-8)}`, amountCents: 3900, idempotencyKey: `late-refund:${late.id}` },
      ]);
      expect(await prisma.order.findUniqueOrThrow({ where: { id: late.id } })).toMatchObject({ status: 'EXPIRED', refundedCents: 3900, sequenceNo: null });
      expect(await prisma.refund.findMany({ where: { orderId: late.id } })).toEqual([
        expect.objectContaining({ amountCents: 3900, status: 'SUCCEEDED' }),
      ]);
      expect(await prisma.notificationOutbox.count({ where: { type: 'ORDER_AUTO_REFUNDED', recipient: 'amy@example.test' } })).toBe(1);
      expect(await counts(l)).toEqual({ options: [{ sold: 1, reserved: 0 }], listing: { sold: 1, reserved: 0, seq: 1 } });
    });
  });

  describe('late payment with a partial fit', () => {
    it('undoes the option update when only the listing-wide capacity is full, then refunds', async () => {
      const l = await listing({ capacities: [5], totalCapacity: 1 });
      const late = await placed(l);
      await prisma.order.update({ where: { id: late.id }, data: { reservationExpiresAt: new Date(Date.now() - 1000) } });
      await t.app.get(ExpiryJob).expireDue();
      const other = await placed(l, { buyer: buyer(2) });
      await deliver(await sessionEvent('checkout.session.completed', other));

      expect((await deliver(await sessionEvent('checkout.session.completed', late))).status).toBe(200);
      expect(t.stripe.refunds).toHaveLength(1);
      // The option had room, the listing did not: nothing of the attempt may remain.
      expect(await counts(l)).toEqual({ options: [{ sold: 1, reserved: 0 }], listing: { sold: 1, reserved: 0, seq: 1 } });
    });
  });

  describe('expiry job', () => {
    it('expires overdue unpaid orders, frees their places and ends their Checkout; a Stripe error does not stop it', async () => {
      const l = await listing({ capacities: [3] });
      const due = await placed(l);
      const fresh = await placed(l, { buyer: buyer(2) });
      await prisma.order.update({ where: { id: due.id }, data: { reservationExpiresAt: new Date(Date.now() - 1000) } });
      t.stripe.failExpire = true;
      expect(await t.app.get(ExpiryJob).expireDue()).toBe(1);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: due.id } })).status).toBe('EXPIRED');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe('PENDING_PAYMENT');
      expect(await counts(l)).toMatchObject({ options: [{ sold: 0, reserved: 1 }] });

      t.stripe.failExpire = false;
      await prisma.order.update({ where: { id: fresh.id }, data: { reservationExpiresAt: new Date(Date.now() - 1000) } });
      await t.app.get(ExpiryJob).expireDue();
      expect(t.stripe.expired).toEqual([{ accountId: l.merchant.stripeAccountId, sessionId: fresh.stripeCheckoutSessionId }]);
    });
  });

  describe('outbox', () => {
    async function paidOrder() {
      const l = await listing();
      const o = await placed(l);
      await deliver(await sessionEvent('checkout.session.completed', o));
      return o;
    }

    it('an email outage never undoes a payment: the row waits and retries on the schedule, then fails', async () => {
      const o = await paidOrder();
      t.email.failing = true;
      const job = t.app.get(OutboxJob);
      const start = new Date();
      expect(await job.run(start)).toEqual({ sent: 0, retrying: 1, failed: 0 });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('PAID');
      const row = await prisma.notificationOutbox.findFirstOrThrow();
      expect(row).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'email provider down' });
      expect(row.nextAttemptAt.getTime() - start.getTime()).toBe(60_000);
      expect(await job.run(start)).toEqual({ sent: 0, retrying: 0, failed: 0 }); // not due yet

      let at = row.nextAttemptAt;
      for (let i = 0; i < 4; i++) {
        await job.run(at);
        at = (await prisma.notificationOutbox.findFirstOrThrow()).nextAttemptAt;
      }
      expect(await prisma.notificationOutbox.findFirstOrThrow()).toMatchObject({ status: 'PENDING', attempts: 5 });
      expect(await job.run(at)).toEqual({ sent: 0, retrying: 0, failed: 1 });
      expect(await prisma.notificationOutbox.findFirstOrThrow()).toMatchObject({ status: 'FAILED', attempts: 6 });
    });

    it('sends the queued confirmation once the provider is back', async () => {
      await paidOrder();
      const job = t.app.get(OutboxJob);
      expect(await job.run()).toEqual({ sent: 1, retrying: 0, failed: 0 });
      expect(await job.run()).toEqual({ sent: 0, retrying: 0, failed: 0 });
      expect(t.email.sent).toHaveLength(1);
      expect(t.email.sent[0]).toMatchObject({ to: 'amy@example.test', subject: '接龙成功 #1：Cherries' });
      expect(await prisma.notificationOutbox.findFirstOrThrow()).toMatchObject({ status: 'SENT', attempts: 0 });
    });

    it('fails a row without a template at once instead of retrying it', async () => {
      await prisma.notificationOutbox.create({
        data: { type: 'NO_SUCH_TEMPLATE', recipient: 'x@example.test', locale: 'en', payload: {}, dedupeKey: 'x' },
      });
      expect(await t.app.get(OutboxJob).run()).toEqual({ sent: 0, retrying: 0, failed: 1 });
      expect(await prisma.notificationOutbox.findFirstOrThrow()).toMatchObject({ status: 'FAILED', attempts: 1 });
    });
  });

  describe('order page API', () => {
    it('shows the buyer their own order with the right token only, without Stripe ids or other buyers', async () => {
      const l = await listing();
      const o = await placed(l);
      const res = await http().get(`/api/v1/public/orders/${o.publicCode}`).set('X-Order-Token', o.accessToken);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        publicCode: o.publicCode,
        status: 'PENDING_PAYMENT',
        canCancel: true,
        items: [{ name: '2kg', quantity: 1, unitPriceCents: 3900 }],
        totalCents: 3900,
        pickupPoint: { label: 'Albany', address: '1 Main St' },
        listing: { shortCode: l.shortCode, title: 'Cherries' },
      });
      const json = JSON.stringify(res.body);
      for (const secret of [o.stripeCheckoutSessionId!, o.accessToken, o.id, 'amy@example.test', '021 555 0101']) {
        expect(json).not.toContain(secret);
      }
      expect((await http().get(`/api/v1/public/orders/${o.publicCode}`).query({ t: `${o.accessToken}x` })).status).toBe(404);
      expect((await http().get(`/api/v1/public/orders/TA-NOPE00`).set('X-Order-Token', o.accessToken)).status).toBe(404);
      // The token is not accepted in the query string, where proxies and request logs would keep it.
      expect((await http().get(`/api/v1/public/orders/${o.publicCode}`).query({ t: o.accessToken })).status).toBe(404);
    });

    it('lets the buyer cancel an unpaid order: places freed, Checkout ended; a second cancel is refused', async () => {
      const l = await listing();
      const o = await placed(l);
      const cancel = () =>
        http().post(`/api/v1/public/orders/${o.publicCode}/cancel`).set('X-Order-Token', o.accessToken).set('Origin', ORIGIN);
      const res = await cancel();
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', canCancel: false });
      expect(await counts(l)).toMatchObject({ options: [{ sold: 0, reserved: 0 }] });
      expect(t.stripe.expired).toEqual([{ accountId: l.merchant.stripeAccountId, sessionId: o.stripeCheckoutSessionId }]);
      expect((await cancel()).body.code).toBe('INVALID_STATE_TRANSITION');
      const wrong = await http().post(`/api/v1/public/orders/${o.publicCode}/cancel`).set('X-Order-Token', 'nope').set('Origin', ORIGIN);
      expect(wrong.status).toBe(404);
    });
  });
});
