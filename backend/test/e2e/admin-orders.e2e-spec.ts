import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { NotificationsService } from '../../src/modules/notifications/notifications.service.js';
import { RecoveryJob } from '../../src/modules/orders/recovery.job.js';
import { RefundJob } from '../../src/modules/orders/refund.job.js';
import { createTestApp, type TestApp } from './support/app.js';
import { resetDb, testPrisma } from './support/db.js';
import { createMerchant } from './support/factories.js';
import { TURNSTILE_PASS } from './support/turnstile-fake.js';

const DAY = 86_400_000;

describe('admin console API: orders, refunds, failed bulk refunds, anonymisation, audit log (DESIGN §9, M8b)', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  let adminId: string;
  const http = () => request(t.app.getHttpServer());
  const admin = { authorization: 'Bearer valid:user_admin' };
  const post = (path: string, body: object) => http().post(`/api/v1/admin/${path}`).set(admin).send(body);
  const get = (path: string) => http().get(`/api/v1/admin/${path}`).set(admin);

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
    t.email.reset();
    t.stripe.reset();
    adminId = (await prisma.user.create({ data: { email: 'ops@tagalong.test', clerkUserId: 'user_admin', role: 'ADMIN' } })).id;
  });

  async function merchant() {
    const m = await createMerchant(prisma);
    return prisma.merchant.update({ where: { id: m.id }, data: { chargesEnabled: true, stripeAccountId: `acct_${m.id.slice(-8)}`, contactEmail: 'shop@example.test' } });
  }

  async function listing(merchantId: string, pricing: 'PAID' | 'FREE' = 'PAID') {
    return prisma.listing.create({
      data: {
        merchantId,
        shortCode: randomUUID().slice(0, 8),
        title: 'Cherries',
        description: 'Fresh',
        type: 'RETAIL',
        fulfilment: 'ONSITE',
        pricing,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        closesAt: new Date(Date.now() + DAY),
        maxQtyPerOrder: 5,
        onePerEmail: false,
        allowSelfCancel: false,
        policyText: 'No refunds after pickup',
        options: { create: [{ name: '2kg', priceCents: pricing === 'PAID' ? 3900 : 0, capacity: 100 }] },
      },
      include: { options: true },
    });
  }
  type Listing = Awaited<ReturnType<typeof listing>>;

  let seq = 0;
  async function order(
    l: Listing,
    status: 'PAID' | 'PENDING_PAYMENT' | 'CONFIRMED',
    over: { email?: string; phone?: string; name?: string; createdAt?: Date; idempotencyKey?: string } = {},
  ) {
    const free = status === 'CONFIRMED';
    const total = free ? 0 : 3900;
    return prisma.order.create({
      data: {
        publicCode: `TA-${randomUUID().slice(0, 6).toUpperCase()}`,
        accessToken: randomUUID(),
        listingId: l.id,
        merchantId: l.merchantId,
        buyerName: over.name ?? 'Amy Lee',
        buyerEmail: over.email ?? `amy-${randomUUID().slice(0, 6)}@example.test`,
        buyerPhone: over.phone ?? '021 555 0101',
        buyerNote: 'Leave at the door',
        formAnswers: { allergies: 'nuts' },
        isFree: free,
        status,
        subtotalCents: total,
        platformFeeCents: 0,
        totalCents: total,
        sequenceNo: status === 'PENDING_PAYMENT' ? null : ++seq,
        paidAt: status === 'PAID' ? new Date() : null,
        stripePaymentIntentId: status === 'PAID' ? `pi_${randomUUID().slice(0, 12)}` : null,
        stripeCheckoutSessionId: free ? null : `cs_${randomUUID().slice(0, 12)}`,
        reservationExpiresAt: free ? null : new Date(Date.now() + 1_800_000),
        ...(over.createdAt && { createdAt: over.createdAt }),
        ...(over.idempotencyKey && { idempotencyKey: over.idempotencyKey }),
        items: {
          create: [
            { optionId: l.options[0].id, quantity: 1, unitPriceCents: total, checkoutName: 'Cherries · 2kg', attendeeName: 'Amy', attendeeAnswers: [{ shirt: 'M' }] },
          ],
        },
      },
    });
  }

  async function drain() {
    let now = new Date();
    for (let i = 0; i < 40 && (await prisma.refundTask.count({ where: { status: 'PENDING' } })); i++) {
      await t.app.get(RefundJob).run(now);
      now = new Date(now.getTime() + 10 * 60_000);
    }
  }

  const audits = (action: string) => prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });

  describe('orders', () => {
    it('search by code, email or phone, newest first, with the buyer masked; nothing in clear', async () => {
      const m = await merchant();
      const l = await listing(m.id);
      const old = await order(l, 'PAID', { email: 'Amy.Lee@Example.test', name: 'Amy Lee', createdAt: new Date(Date.now() - DAY) });
      const recent = await order(l, 'PAID', { email: 'amy.lee@example.test', phone: '+64 21 555 0199' });
      await order(l, 'PAID', { email: 'ben@example.test', phone: '022 777 8888' });

      const byEmail = await get('orders?q=AMY.LEE@example.TEST');
      expect(byEmail.status).toBe(200);
      expect(byEmail.body.items.map((o: { id: string }) => o.id)).toEqual([recent.id, old.id]);
      expect(byEmail.body.items[1]).toMatchObject({
        publicCode: old.publicCode,
        buyerName: 'Amy L.',
        buyerEmail: 'A***@Example.test',
        buyerPhone: '*** 0101',
        anonymized: false,
        totalCents: 3900,
        refundableCents: 3900,
        openDispute: false,
        listing: { id: l.id, title: 'Cherries' },
        merchant: { id: m.id },
      });
      const body = JSON.stringify(byEmail.body);
      for (const secret of ['amy.lee@', 'Amy.Lee@', '555 0101', '5550101', 'Leave at the door', 'nuts']) expect(body).not.toContain(secret);

      expect((await get(`orders?q=${old.publicCode.toLowerCase()}`)).body.items.map((o: { id: string }) => o.id)).toEqual([old.id]);
      expect((await get(`orders?q=${old.publicCode.slice(3)}`)).body.items.map((o: { id: string }) => o.id)).toEqual([old.id]);
      expect((await get('orders?q=0215550199')).body.items.map((o: { id: string }) => o.id)).toEqual([recent.id]);
      expect((await get(`orders?q=${encodeURIComponent('+64 21 555 0101')}`)).body.items.map((o: { id: string }) => o.id)).toEqual([old.id]);
      expect((await get('orders?q=nobody@example.test')).body.items).toEqual([]);
      expect((await get('orders')).body.items).toHaveLength(3);
    });

    it('pages 50 at a time, newest first, by cursor', async () => {
      const l = await listing((await merchant()).id);
      for (let n = 0; n < 51; n++) await order(l, 'PAID', { createdAt: new Date(Date.now() - n * 60_000) });
      const first = await get('orders');
      expect(first.body.items).toHaveLength(50);
      const second = await get(`orders?cursor=${first.body.nextCursor}`);
      expect(second.body.items).toHaveLength(1);
      expect(second.body.nextCursor).toBeNull();
      const all = [...first.body.items, ...second.body.items].map((o: { createdAt: string }) => o.createdAt);
      expect(all).toEqual([...all].sort().reverse());
    });

    it('reveal-pii returns the buyer in full and is audited; an unknown order reveals nothing and leaves no record', async () => {
      const o = await order(await listing((await merchant()).id), 'PAID', { email: 'amy@example.test' });
      const res = await post(`orders/${o.id}/reveal-pii`, { reason: 'Buyer complaint #12' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        buyerName: 'Amy Lee',
        buyerEmail: 'amy@example.test',
        buyerPhone: '021 555 0101',
        buyerNote: 'Leave at the door',
        formAnswers: { allergies: 'nuts' },
        items: [{ optionName: '2kg', attendeeName: 'Amy', attendeeAnswers: [{ shirt: 'M' }] }],
      });
      expect(await audits('PII_REVEAL')).toEqual([expect.objectContaining({ actorUserId: adminId, targetType: 'order', targetId: o.id, reason: 'Buyer complaint #12' })]);

      expect((await post(`orders/${randomUUID()}/reveal-pii`, { reason: 'x' })).status).toBe(404);
      expect((await post(`orders/${o.id}/reveal-pii`, {})).status).toBe(400);
      expect(await prisma.auditLog.count()).toBe(1);
    });

    it('refund on the merchant’s behalf: refunded from the merchant’s account, audited, the merchant emailed', async () => {
      const m = await merchant();
      const o = await order(await listing(m.id), 'PAID');
      const res = await post(`orders/${o.id}/refund`, { amountCents: 1000, reason: 'Never delivered' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedCents: 1000, refundableCents: 2900, pendingRefundCents: 0 });
      expect(res.body.refunds).toEqual([expect.objectContaining({ amountCents: 1000, status: 'SUCCEEDED', reason: 'Never delivered' })]);
      expect(t.stripe.refunds).toEqual([expect.objectContaining({ accountId: m.stripeAccountId, paymentIntentId: o.stripePaymentIntentId, amountCents: 1000 })]);
      const [audit] = await audits('REFUND_CREATE');
      expect(audit).toMatchObject({ actorUserId: adminId, targetType: 'order', targetId: o.id, reason: 'Never delivered', metadata: { amountCents: 1000, refundId: res.body.refunds[0].id } });
      expect(await prisma.notificationOutbox.findFirstOrThrow({ where: { type: 'MERCHANT_REFUNDED_BY_ADMIN' } })).toMatchObject({
        recipient: 'shop@example.test',
        payload: { publicCode: o.publicCode, listingTitle: 'Cherries', amountCents: 1000, reason: 'Never delivered' },
      });

      const over = await post(`orders/${o.id}/refund`, { amountCents: 2901, reason: 'Too much' });
      expect(over.status).toBe(409);
      expect(over.body).toMatchObject({ code: 'REFUND_EXCEEDS_TOTAL', details: { refundableCents: 2900 } });
      const free = await order(await listing(m.id, 'FREE'), 'CONFIRMED');
      expect((await post(`orders/${free.id}/refund`, { amountCents: 1, reason: 'x' })).body.code).toBe('INVALID_STATE_TRANSITION');
      expect(await prisma.refund.count()).toBe(1);
      expect(await prisma.auditLog.count()).toBe(1);
    });
  });

  describe('failed bulk refunds', () => {
    /** A takedown with refunds of three paid orders, the first of which Stripe keeps failing. */
    async function failedTakedown() {
      const l = await listing((await merchant()).id);
      const orders = [await order(l, 'PAID'), await order(l, 'PAID'), await order(l, 'PAID')];
      expect((await post(`listings/${l.id}/takedown`, { reason: 'Counterfeit', refundAll: true })).status).toBe(200);
      const failing = await prisma.refundTask.findFirstOrThrow({ where: { orderId: orders[0].id } });
      t.stripe.failRefundKeys.add(failing.id);
      await drain();
      t.stripe.failRefundKeys.clear();
      return { l, orders, failing };
    }

    it('lists cancellations with their failed refunds; a retry re-queues one, audited, and it then succeeds', async () => {
      const { l, orders, failing } = await failedTakedown();
      const list = await get('cancellations?status=COMPLETED_WITH_FAILURES');
      expect(list.status).toBe(200);
      expect(list.body.items).toEqual([
        expect.objectContaining({
          status: 'COMPLETED_WITH_FAILURES',
          totalOrders: 3,
          succeeded: 2,
          failed: 1,
          pending: 0,
          reason: 'Counterfeit',
          refundAll: true,
          listing: expect.objectContaining({ id: l.id }),
          failedRefunds: [expect.objectContaining({ id: failing.id, orderPublicCode: orders[0].publicCode, amountCents: 3900, attempts: 5, refused: false })],
        }),
      ]);
      expect((await get('cancellations?status=COMPLETED')).body.items).toEqual([]);

      const retried = await post(`refund-tasks/${failing.id}/retry`, { reason: 'Stripe outage over' });
      expect(retried.status).toBe(200);
      expect(retried.body).toMatchObject({ status: 'RUNNING', failed: 0, pending: 1, failedRefunds: [] });
      expect(await audits('REFUND_RETRY')).toEqual([
        expect.objectContaining({ targetType: 'refund_task', targetId: failing.id, reason: 'Stripe outage over', metadata: { orderId: orders[0].id, amountCents: 3900 } }),
      ]);
      await drain();
      expect(await prisma.listingCancellation.findFirstOrThrow({ where: { listingId: l.id } })).toMatchObject({ status: 'COMPLETED', succeeded: 3, failed: 0 });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orders[0].id } })).status).toBe('REFUNDED');

      const again = await post(`refund-tasks/${failing.id}/retry`, { reason: 'again' });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('INVALID_STATE_TRANSITION');
      expect((await post(`refund-tasks/${randomUUID()}/retry`, { reason: 'x' })).status).toBe(404);
      expect(await prisma.auditLog.count({ where: { action: 'REFUND_RETRY' } })).toBe(1);
    });

    it('two retries of the same refund at once: one re-queues it, the other finds it no longer failed', async () => {
      const { l, failing } = await failedTakedown();
      const results = await Promise.all([post(`refund-tasks/${failing.id}/retry`, { reason: 'a' }), post(`refund-tasks/${failing.id}/retry`, { reason: 'b' })]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await prisma.listingCancellation.findFirstOrThrow({ where: { listingId: l.id } })).toMatchObject({ status: 'RUNNING', failed: 0 });
      expect(await prisma.refund.count({ where: { status: 'PENDING' } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { action: 'REFUND_RETRY' } })).toBe(1);
    });

    it('a retry is refused once the money was refunded another way since', async () => {
      const { orders, failing } = await failedTakedown();
      expect((await post(`orders/${orders[0].id}/refund`, { amountCents: 3900, reason: 'Refunded by hand' })).status).toBe(200);
      const res = await post(`refund-tasks/${failing.id}/retry`, { reason: 'retry' });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'REFUND_EXCEEDS_TOTAL', details: { refundableCents: 0 } });
      expect((await prisma.refundTask.findUniqueOrThrow({ where: { id: failing.id } })).status).toBe('FAILED');
      expect(await prisma.auditLog.count({ where: { action: 'REFUND_RETRY' } })).toBe(0);
    });

    it('a single refund (not a cancellation’s) cannot be retried here', async () => {
      const o = await order(await listing((await merchant()).id), 'PAID');
      t.stripe.newRefundStatus = 'failed';
      await post(`orders/${o.id}/refund`, { amountCents: 100, reason: 'x' });
      const task = await prisma.refundTask.findFirstOrThrow({ where: { orderId: o.id } });
      expect(task.status).toBe('FAILED');
      expect((await post(`refund-tasks/${task.id}/retry`, { reason: 'x' })).status).toBe(404);
    });
  });

  describe('anonymisation', () => {
    it('replaces every PII field of the address’s orders, kills the old link, keeps money and status, and audits a hash', async () => {
      const m = await merchant();
      const l = await listing(m.id);
      const paid = await order(l, 'PAID', { email: 'Amy@Example.test' });
      const free = await order(await listing(m.id, 'FREE'), 'CONFIRMED', { email: 'amy@example.test' });
      const other = await order(l, 'PAID', { email: 'ben@example.test' });
      await prisma.notificationOutbox.createMany({
        data: [
          { type: 'EVENT_REMINDER', recipient: 'amy@example.test', locale: 'en', payload: { listingTitle: 'Cherries' }, dedupeKey: `EVENT_REMINDER:${free.id}` },
          { type: 'ORDER_RECOVERY', recipient: 'AMY@example.test', locale: 'en', payload: { orders: [] }, dedupeKey: 'ORDER_RECOVERY:amy@example.test:2026-10-31T10:1', status: 'SENT', sentAt: new Date() },
          { type: 'ORDER_CONFIRMED', recipient: 'ben@example.test', locale: 'en', payload: { publicCode: other.publicCode }, dedupeKey: `ORDER_CONFIRMED:${other.id}` },
        ],
      });
      await prisma.orderRecoveryRequest.create({ data: { email: 'amy@example.test', locale: 'en' } });

      const res = await post('buyers/anonymize', { email: 'AMY@example.test', reason: 'Privacy request #7' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ orderCount: 2, publicCodes: expect.arrayContaining([paid.publicCode, free.publicCode]) });

      for (const before of [paid, free]) {
        const after = await prisma.order.findUniqueOrThrow({ where: { id: before.id }, include: { items: true } });
        expect(after).toMatchObject({
          buyerName: 'Anonymized',
          buyerEmail: `${before.id}@anonymized.invalid`,
          buyerPhone: '',
          buyerNote: null,
          formAnswers: {},
          displayAnonymous: true,
          status: before.status,
          totalCents: before.totalCents,
          refundedCents: 0,
          anonymizedAt: expect.any(Date),
        });
        expect(after.accessToken).not.toBe(before.accessToken);
        expect(after.items[0]).toMatchObject({ attendeeName: null, attendeeAnswers: [] });
        const page = await http().get(`/api/v1/public/orders/${before.publicCode}`).set('X-Order-Token', before.accessToken);
        expect(page.status).toBe(404);
      }
      expect(await prisma.order.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ buyerEmail: 'ben@example.test', anonymizedAt: null });

      const outbox = await prisma.notificationOutbox.findMany({ orderBy: { type: 'asc' } });
      expect(outbox.map((r) => [r.type, r.recipient, r.status, r.payload])).toEqual([
        ['EVENT_REMINDER', 'erased@anonymized.invalid', 'FAILED', {}],
        ['ORDER_CONFIRMED', 'ben@example.test', 'PENDING', { publicCode: other.publicCode }],
        ['ORDER_RECOVERY', 'erased@anonymized.invalid', 'SENT', {}],
      ]);
      expect(outbox.find((r) => r.type === 'ORDER_RECOVERY')!.dedupeKey).not.toContain('amy');
      expect(await prisma.orderRecoveryRequest.count()).toBe(0);

      const [audit] = await audits('BUYER_ANONYMIZE');
      expect(audit).toMatchObject({
        actorUserId: adminId,
        targetType: 'buyer',
        targetId: createHash('sha256').update('amy@example.test').digest('hex'),
        reason: 'Privacy request #7',
        metadata: { orderCount: 2, orderIds: expect.arrayContaining([paid.id, free.id]) },
      });
      expect(JSON.stringify(audit).toLowerCase()).not.toContain('amy@');

      // Later emails to an anonymized buyer are never queued: a refund settling now tells nobody.
      expect((await post(`orders/${paid.id}/refund`, { amountCents: 3900, reason: 'Goodwill' })).body.status).toBe('REFUNDED');
      expect(await prisma.notificationOutbox.count({ where: { type: 'ORDER_REFUNDED' } })).toBe(0);
      expect(await prisma.notificationOutbox.count({ where: { type: 'MERCHANT_REFUNDED_BY_ADMIN' } })).toBe(1);
      expect((await get(`orders?q=${paid.publicCode}`)).body.items[0]).toMatchObject({ anonymized: true, buyerName: 'Anonymized', buyerEmail: `${paid.id[0]}***@anonymized.invalid` });
    });

    it('a replay of the original order request answers 404 and gives away neither the new token nor a link', async () => {
      const m = await merchant();
      const paidListing = await listing(m.id);
      const freeListing = await listing(m.id, 'FREE');
      const paid = await order(paidListing, 'PAID', { email: 'amy@example.test', idempotencyKey: randomUUID() });
      const free = await order(freeListing, 'CONFIRMED', { email: 'amy@example.test', idempotencyKey: randomUUID() });
      expect((await post('buyers/anonymize', { email: 'amy@example.test', reason: 'Privacy request' })).status).toBe(200);

      for (const [o, l] of [[paid, paidListing], [free, freeListing]] as const) {
        const token = (await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).accessToken;
        const res = await http()
          .post(`/api/v1/public/listings/${l.shortCode}/orders`)
          .set('Origin', 'http://localhost:3800')
          .set('Idempotency-Key', o.idempotencyKey!)
          .send({ items: [{ optionId: l.options[0].id, quantity: 1 }], buyer: { name: 'Amy Lee', email: 'amy@example.test', phone: '021 555 0101' }, anonymous: false, turnstileToken: TURNSTILE_PASS });
        expect([o.publicCode, res.status]).toEqual([o.publicCode, 404]);
        expect(JSON.stringify(res.body)).not.toContain(token);
      }
      expect(await prisma.order.count()).toBe(2);
    });

    it('a find-my-orders email being prepared meanwhile is erased too, not sent with the old address and links', async () => {
      const o = await order(await listing((await merchant()).id), 'PAID', { email: 'amy@example.test' });
      await prisma.orderRecoveryRequest.create({ data: { email: 'amy@example.test', locale: 'en' } });
      // Hold the recovery job between reading the orders and queueing its email, as a slow instance would.
      const notifications = t.app.get(NotificationsService);
      const enqueue = notifications.enqueue.bind(notifications);
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let reached!: () => void;
      const atEnqueue = new Promise<void>((resolve) => (reached = resolve));
      const spy = vi.spyOn(notifications, 'enqueue').mockImplementationOnce(async (...args) => {
        reached();
        await held;
        return enqueue(...args);
      });
      try {
        const recovery = t.app.get(RecoveryJob).run();
        await atEnqueue;
        // supertest sends on then(): start it now, while the job is held.
        const anonymizing = post('buyers/anonymize', { email: 'amy@example.test', reason: 'Privacy request' }).then((r) => r);
        await new Promise((r) => setTimeout(r, 300));
        release();
        expect(await recovery).toBe(1);
        expect((await anonymizing).status).toBe(200);
      } finally {
        spy.mockRestore();
      }
      const rows = await prisma.notificationOutbox.findMany({ where: { type: 'ORDER_RECOVERY' } });
      expect(rows.map((r) => [r.recipient, r.status, r.payload])).toEqual([['erased@anonymized.invalid', 'FAILED', {}]]);
      expect(JSON.stringify(rows)).not.toContain(o.publicCode);
    });

    it('delivery errors that may quote the address are erased from sent and failed emails too', async () => {
      const o = await order(await listing((await merchant()).id), 'PAID', { email: 'amy@example.test' });
      await prisma.notificationOutbox.createMany({
        data: [
          { type: 'ORDER_CONFIRMED', recipient: 'amy@example.test', locale: 'en', payload: {}, dedupeKey: `ORDER_CONFIRMED:${o.id}`, status: 'FAILED', lastError: '550 <amy@example.test> mailbox full' },
          { type: 'ORDER_REFUNDED', recipient: 'amy@example.test', locale: 'en', payload: {}, dedupeKey: `ORDER_REFUNDED:${o.id}`, status: 'SENT', sentAt: new Date(), lastError: '421 amy@example.test try later' },
        ],
      });
      expect((await post('buyers/anonymize', { email: 'amy@example.test', reason: 'Privacy request' })).status).toBe(200);
      const rows = await prisma.notificationOutbox.findMany({ orderBy: { type: 'asc' } });
      expect(rows.map((r) => [r.type, r.status, r.lastError])).toEqual([
        ['ORDER_CONFIRMED', 'FAILED', null],
        ['ORDER_REFUNDED', 'SENT', null],
      ]);
    });

    it('refused while an order awaits payment or is under dispute, changing nothing; an unknown address is 404', async () => {
      const m = await merchant();
      const l = await listing(m.id);
      const pending = await order(l, 'PENDING_PAYMENT', { email: 'amy@example.test' });
      const disputed = await order(l, 'PAID', { email: 'amy@example.test' });
      await order(l, 'PAID', { email: 'amy@example.test' });
      await prisma.dispute.create({
        data: { id: 'dp_1', orderId: disputed.id, merchantId: m.id, amountCents: 3900, reason: 'fraudulent', status: 'needs_response', open: true, lastEventAt: new Date() },
      });

      const res = await post('buyers/anonymize', { email: 'amy@example.test', reason: 'Privacy request' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ANONYMIZE_BLOCKED');
      expect([...res.body.details.publicCodes].sort()).toEqual([pending.publicCode, disputed.publicCode].sort());
      expect(await prisma.order.count({ where: { anonymizedAt: { not: null } } })).toBe(0);
      expect(await prisma.order.count({ where: { buyerEmail: 'amy@example.test' } })).toBe(3);

      expect((await post('buyers/anonymize', { email: 'nobody@example.test', reason: 'x' })).status).toBe(404);
      expect((await post('buyers/anonymize', { email: 'not-an-email', reason: 'x' })).status).toBe(400);
      expect(await prisma.auditLog.count()).toBe(0);
    });
  });

  describe('audit log', () => {
    it('newest first, filtered by actor email, action and target, paged by cursor', async () => {
      const other = await prisma.user.create({ data: { email: 'second@tagalong.test', clerkUserId: 'user_admin2', role: 'ADMIN' } });
      const base = Date.now() - DAY;
      await prisma.auditLog.createMany({
        data: Array.from({ length: 51 }, (_, n) => ({
          actorUserId: n % 2 ? other.id : adminId,
          actorRole: 'ADMIN' as const,
          action: n === 0 ? 'PII_REVEAL' : 'MERCHANT_NOTE',
          targetType: 'merchant',
          targetId: n === 0 ? 'target-0' : `target-${n}`,
          reason: `r${n}`,
          ip: '127.0.0.1',
          createdAt: new Date(base + n * 1000),
        })),
      });
      await prisma.auditLog.create({ data: { actorRole: 'SYSTEM', action: 'ADMIN_ROLE_GRANT', targetType: 'user', targetId: adminId, createdAt: new Date(base + 99_000) } });

      const first = await get('audit-log');
      expect(first.status).toBe(200);
      expect(first.body.items).toHaveLength(50);
      expect(first.body.items[0]).toMatchObject({ action: 'ADMIN_ROLE_GRANT', actorRole: 'SYSTEM', actorEmail: null });
      expect(first.body.items[1]).toMatchObject({ action: 'MERCHANT_NOTE', actorEmail: 'ops@tagalong.test', reason: 'r50', ip: '127.0.0.1' });
      const second = await get(`audit-log?cursor=${first.body.nextCursor}`);
      expect(second.body.items.map((e: { reason: string }) => e.reason)).toEqual(['r1', 'r0']);
      expect(second.body.nextCursor).toBeNull();

      const reveals = await get('audit-log?action=PII_REVEAL');
      expect(reveals.body.items.map((e: { targetId: string }) => e.targetId)).toEqual(['target-0']);
      expect((await get('audit-log?targetId=target-7')).body.items.map((e: { reason: string }) => e.reason)).toEqual(['r7']);
      const bySecond = await get('audit-log?actor=SECOND@tagalong.test');
      expect(bySecond.body.items).toHaveLength(25);
      expect(new Set(bySecond.body.items.map((e: { actorEmail: string }) => e.actorEmail))).toEqual(new Set(['second@tagalong.test']));
      expect((await get('audit-log?action=lower-case')).status).toBe(400);
    });
  });
});
