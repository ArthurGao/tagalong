import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './support/app.js';
import { resetDb, testPrisma } from './support/db.js';
import { createMerchant } from './support/factories.js';
import { TURNSTILE_PASS } from './support/turnstile-fake.js';

const ORIGIN = 'http://localhost:3800';
const DAY = 86_400_000;

describe('admin console API: merchants, listings, disputes, risk, audit (DESIGN §9, M8a)', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  let adminId: string;
  const http = () => request(t.app.getHttpServer());
  const as = (clerkUserId: string) => ({ authorization: `Bearer valid:${clerkUserId}` });
  const admin = as('user_admin');

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
    t.turnstile.reset();
    adminId = (await prisma.user.create({ data: { email: 'ops@tagalong.test', clerkUserId: 'user_admin', role: 'ADMIN' } })).id;
  });

  async function merchant(over: { createdAt?: Date; displayName?: string } = {}) {
    const m = await createMerchant(prisma);
    return prisma.merchant.update({
      where: { id: m.id },
      data: { chargesEnabled: true, stripeAccountId: `acct_${m.id.slice(-8)}`, createdAt: over.createdAt ?? new Date(Date.now() - 60 * DAY), displayName: over.displayName ?? 'Kiwi Fruit' },
    });
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
  async function order(l: Listing, status: 'PAID' | 'PENDING_PAYMENT' | 'CONFIRMED', over: { paidAt?: Date; totalCents?: number; refundedCents?: number } = {}) {
    const paid = status === 'PAID';
    const free = status === 'CONFIRMED';
    const total = free ? 0 : (over.totalCents ?? 3900);
    const o = await prisma.order.create({
      data: {
        publicCode: `TA-${randomUUID().slice(0, 6).toUpperCase()}`,
        accessToken: randomUUID(),
        listingId: l.id,
        merchantId: l.merchantId,
        buyerName: 'Amy Lee',
        buyerEmail: `amy-${randomUUID().slice(0, 6)}@example.test`,
        buyerPhone: '021 555 0101',
        isFree: free,
        status,
        subtotalCents: total,
        platformFeeCents: 0,
        totalCents: total,
        refundedCents: over.refundedCents ?? 0,
        sequenceNo: paid || free ? ++seq : null,
        paidAt: paid ? (over.paidAt ?? new Date()) : null,
        stripePaymentIntentId: paid ? `pi_${randomUUID().slice(0, 12)}` : null,
        stripeCheckoutSessionId: free ? null : `cs_${randomUUID().slice(0, 12)}`,
        reservationExpiresAt: free ? null : new Date(Date.now() + 1_800_000),
        items: { create: [{ optionId: l.options[0].id, quantity: 1, unitPriceCents: total, checkoutName: 'Cherries · 2kg' }] },
      },
    });
    const counter = status === 'PENDING_PAYMENT' ? 'reserved_count' : 'sold_count';
    await prisma.$executeRawUnsafe(`UPDATE listing_option SET ${counter} = ${counter} + 1 WHERE id = '${l.options[0].id}'`);
    await prisma.$executeRawUnsafe(`UPDATE listing SET ${counter} = ${counter} + 1 WHERE id = '${l.id}'`);
    return o;
  }

  const publicListing = (l: Listing) => http().get(`/api/v1/public/listings/${l.shortCode}`);
  const buy = (l: Listing) =>
    http()
      .post(`/api/v1/public/listings/${l.shortCode}/orders`)
      .set('Origin', ORIGIN)
      .set('Idempotency-Key', randomUUID())
      .send({
        items: [{ optionId: l.options[0].id, quantity: 1 }],
        buyer: { name: 'Ben', email: 'ben@example.test', phone: '021 555 0102' },
        anonymous: false,
        turnstileToken: TURNSTILE_PASS,
      });
  const post = (path: string, body: object) => http().post(`/api/v1/admin/${path}`).set(admin).send(body);
  const get = (path: string) => http().get(`/api/v1/admin/${path}`).set(admin);

  describe('access', () => {
    it('every admin route: 401 without a session, 403 for a merchant, open to an admin', async () => {
      const m = await merchant();
      const l = await listing(m.id);
      await createMerchant(prisma, { clerkUserId: 'user_shop' });
      const routes: [string, string][] = [
        ['get', 'stats'],
        ['get', 'disputes'],
        ['get', 'merchants'],
        ['get', `merchants/${m.id}`],
        ['post', `merchants/${m.id}/suspend`],
        ['post', `merchants/${m.id}/reinstate`],
        ['post', `merchants/${m.id}/notes`],
        ['get', 'listings'],
        ['get', `listings/${l.id}`],
        ['post', `listings/${l.id}/close`],
        ['post', `listings/${l.id}/takedown`],
        ['post', `listings/${l.id}/restore`],
      ];
      for (const [method, path] of routes) {
        const call = () => (method === 'get' ? http().get(`/api/v1/admin/${path}`) : http().post(`/api/v1/admin/${path}`).send({ reason: 'x', note: 'x', refundAll: false }));
        expect([path, (await call()).status]).toEqual([path, 401]);
        expect([path, (await call().set(as('user_shop'))).status]).toEqual([path, 403]);
      }
      expect((await get('stats')).status).toBe(200);
      expect(await prisma.auditLog.count()).toBe(0);
      expect((await prisma.merchant.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('ACTIVE');
    });

    it('a write without a reason is refused before anything changes', async () => {
      const m = await merchant();
      const res = await post(`merchants/${m.id}/suspend`, {});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect((await prisma.merchant.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('ACTIVE');
    });
  });

  describe('merchants', () => {
    it('suspend: the listing page says suspended and ordering is refused at once; reinstate opens it again', async () => {
      const m = await merchant();
      const l = await listing(m.id);
      expect((await publicListing(l)).body.availability).toBe('OPEN');

      const suspended = await post(`merchants/${m.id}/suspend`, { reason: 'Fake goods reported' });
      expect(suspended.status).toBe(200);
      expect(suspended.body).toMatchObject({ status: 'SUSPENDED', suspendedReason: 'Fake goods reported' });
      expect((await publicListing(l)).body.availability).toBe('SUSPENDED');
      const refused = await buy(l);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('MERCHANT_SUSPENDED');
      expect((await post(`merchants/${m.id}/suspend`, { reason: 'again' })).body.code).toBe('INVALID_STATE_TRANSITION');

      const back = await post(`merchants/${m.id}/reinstate`, { reason: 'Cleared after review' });
      expect(back.body).toMatchObject({ status: 'ACTIVE', suspendedReason: null, suspendedAt: null });
      expect((await publicListing(l)).body.availability).toBe('OPEN');
      expect((await buy(l)).status).toBe(201);
      const mails = await prisma.notificationOutbox.findMany({ where: { recipient: m.contactEmail }, orderBy: { createdAt: 'asc' } });
      expect(mails.map((n) => n.type)).toEqual(['MERCHANT_SUSPENDED', 'MERCHANT_REINSTATED']);
      expect(mails[0].payload).toEqual({ merchantName: 'Kiwi Fruit', reason: 'Fake goods reported' });
    });

    it('a shop whose owner deleted their account cannot be reinstated', async () => {
      const m = await merchant();
      await prisma.user.update({ where: { id: m.ownerUserId }, data: { deletedAt: new Date() } });
      await prisma.merchant.update({ where: { id: m.id }, data: { status: 'SUSPENDED', suspendedReason: 'Account deleted' } });
      const res = await post(`merchants/${m.id}/reinstate`, { reason: 'try' });
      expect(res.status).toBe(409);
      expect((await prisma.merchant.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('SUSPENDED');
      expect((await get(`merchants/${m.id}`)).body.ownerDeleted).toBe(true);
    });

    it('a reinstatement racing the owner deleting their account waits for it and refuses', async () => {
      const m = await merchant();
      await prisma.merchant.update({ where: { id: m.id }, data: { status: 'SUSPENDED', suspendedReason: 'Review' } });
      // The owner's account deletion holds their user row (uncommitted) when the admin reinstates the shop.
      let commit!: () => void;
      const committed = new Promise<void>((r) => (commit = r));
      let deleting = false;
      const deletion = prisma.$transaction(
        async (tx) => {
          await tx.user.update({ where: { id: m.ownerUserId }, data: { deletedAt: new Date() } });
          deleting = true;
          await committed;
        },
        { timeout: 20_000 },
      );
      await vi.waitFor(() => expect(deleting).toBe(true));
      const reinstating = post(`merchants/${m.id}/reinstate`, { reason: 'Cleared' }).then((r) => r);
      await vi.waitFor(
        async () => {
          const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
            SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`;
          expect(waiting).toBeGreaterThan(0);
        },
        { timeout: 10_000 },
      );
      commit();
      await deletion;
      expect((await reinstating).status).toBe(409);
      expect((await prisma.merchant.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('SUSPENDED');
    }, 30_000);

    it('notes are kept, newest first, with their author', async () => {
      const m = await merchant();
      expect((await post(`merchants/${m.id}/notes`, { note: 'Called the owner' })).status).toBe(201);
      await post(`merchants/${m.id}/notes`, { note: 'Sent documents' });
      const detail = await get(`merchants/${m.id}`);
      expect(detail.body.notes.map((n: { note: string; authorEmail: string }) => [n.note, n.authorEmail])).toEqual([
        ['Sent documents', 'ops@tagalong.test'],
        ['Called the owner', 'ops@tagalong.test'],
      ]);
      expect((await post(`merchants/${randomUUID()}/notes`, { note: 'x' })).status).toBe(404);
    });

    it('risk flags: one merchant per rule, and ?risk=true lists only flagged ones', async () => {
      const quiet = await merchant({ displayName: 'Quiet' });
      await merchant({ displayName: 'Fresh', createdAt: new Date(Date.now() - 2 * DAY) });
      const refunds = await merchant({ displayName: 'Refunds' });
      const disputed = await merchant({ displayName: 'Disputed' });
      const spike = await merchant({ displayName: 'Spike' });

      // Quiet: steady sales, about 1,000 cents a day for 30 days, nothing today.
      const ql = await listing(quiet.id);
      for (const d of [3, 10, 20]) await order(ql, 'PAID', { paidAt: new Date(Date.now() - d * DAY), totalCents: 10_000 });
      const rl = await listing(refunds.id);
      await order(rl, 'PAID', { paidAt: new Date(Date.now() - 5 * DAY), totalCents: 10_000, refundedCents: 2_000 });
      const dl = await listing(disputed.id);
      const dOrder = await order(dl, 'PAID', { paidAt: new Date(Date.now() - 5 * DAY) });
      await prisma.dispute.create({
        data: { id: 'dp_risk', orderId: dOrder.id, merchantId: disputed.id, amountCents: 3900, reason: 'fraudulent', status: 'needs_response', open: true, lastEventAt: new Date() },
      });
      const sl = await listing(spike.id);
      await order(sl, 'PAID', { paidAt: new Date(Date.now() - 10 * DAY), totalCents: 3_000 }); // 100 a day
      await order(sl, 'PAID', { paidAt: new Date(), totalCents: 5_000 });

      const all = await get('merchants');
      const flagsOf = (rows: { displayName: string; riskFlags: string[] }[]) => Object.fromEntries(rows.map((r) => [r.displayName, r.riskFlags]));
      // Disputed's order was 5 days ago: only its dispute counts. Quiet sold 30,000 in 30 days and nothing today.
      expect(flagsOf(all.body.items)).toEqual({
        Quiet: [],
        Fresh: ['NEW_MERCHANT'],
        Refunds: ['HIGH_REFUND_RATE'],
        Disputed: ['OPEN_DISPUTE'],
        Spike: ['GMV_SPIKE'],
      });
      const risky = await get('merchants?risk=true');
      expect(risky.body.items.map((r: { displayName: string }) => r.displayName).sort()).toEqual(['Disputed', 'Fresh', 'Refunds', 'Spike']);
      const detail = await get(`merchants/${refunds.id}`);
      expect(detail.body.figures).toMatchObject({ paidCents90d: 10_000, refundedCents90d: 2_000, openDisputes: 0 });
    });

    it('pages 50 at a time, newest first, by cursor', async () => {
      for (let i = 0; i < 52; i++) await merchant({ createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)) });
      const first = await get('merchants');
      expect(first.body.items).toHaveLength(50);
      const second = await get(`merchants?cursor=${first.body.nextCursor}`);
      expect(second.body).toMatchObject({ nextCursor: null });
      expect(second.body.items).toHaveLength(2);
      const created = [...first.body.items, ...second.body.items].map((r: { createdAt: string }) => r.createdAt);
      expect(created).toEqual([...created].sort().reverse());
      expect(new Set([...first.body.items, ...second.body.items].map((r: { id: string }) => r.id)).size).toBe(52);
    });
  });

  describe('listings', () => {
    it('close: an open listing stops taking orders, orders stay', async () => {
      const l = await listing((await merchant()).id);
      const o = await order(l, 'PAID');
      const res = await post(`listings/${l.id}/close`, { reason: 'Supplier fell through' });
      expect(res.body).toMatchObject({ status: 'CLOSED', canClose: false, canTakedown: true, canRestore: false });
      expect((await publicListing(l)).body.availability).toBe('CLOSED');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('PAID');
      expect((await post(`listings/${l.id}/close`, { reason: 'again' })).body.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('takedown without refunds: taken down publicly, paid orders kept, unpaid ended; restore brings it back CLOSED', async () => {
      const m = await merchant();
      const l = await listing(m.id);
      const paid = await order(l, 'PAID');
      const unpaid = await order(l, 'PENDING_PAYMENT');
      const down = await post(`listings/${l.id}/takedown`, { reason: 'Counterfeit brand', refundAll: false });
      expect(down.status).toBe(200);
      expect(down.body).toMatchObject({ status: 'CANCELLED', takenDown: true, takenDownReason: 'Counterfeit brand', canRestore: true, cancellation: { refundAll: false, status: 'COMPLETED' } });
      expect((await publicListing(l)).body.availability).toBe('TAKEN_DOWN');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe('PAID');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: unpaid.id } })).status).toBe('EXPIRED');
      expect(t.stripe.expired.map((e) => e.sessionId)).toEqual([unpaid.stripeCheckoutSessionId]);
      expect(await prisma.refundTask.count()).toBe(0);
      expect(await prisma.notificationOutbox.findFirstOrThrow({ where: { type: 'LISTING_TAKEN_DOWN' } })).toMatchObject({
        recipient: m.contactEmail,
        payload: { listingTitle: 'Cherries', reason: 'Counterfeit brand', refundAll: false },
      });

      const back = await post(`listings/${l.id}/restore`, { reason: 'Merchant proved authenticity' });
      expect(back.body).toMatchObject({ status: 'CLOSED', takenDown: false, takenDownReason: null, cancellation: null, canRestore: false });
      expect((await publicListing(l)).body.availability).toBe('CLOSED');
      expect((await post(`listings/${l.id}/restore`, { reason: 'again' })).body.code).toBe('INVALID_STATE_TRANSITION');
      // Taken down again later: the earlier record is gone, so this works.
      expect((await post(`listings/${l.id}/takedown`, { reason: 'Again', refundAll: false })).status).toBe(200);
    });

    it('takedown with refunds: paid orders queued for a full refund, and it cannot be restored', async () => {
      const l = await listing((await merchant()).id);
      const a = await order(l, 'PAID');
      const b = await order(l, 'PAID');
      const down = await post(`listings/${l.id}/takedown`, { reason: 'Scam', refundAll: true });
      expect(down.body).toMatchObject({ takenDown: true, canRestore: false, cancellation: { refundAll: true, status: 'RUNNING', totalOrders: 2 } });
      const tasks = await prisma.refundTask.findMany({ orderBy: { orderId: 'asc' } });
      expect(tasks.map((x) => [x.orderId, x.amountCents])).toEqual([[a.id, 3900], [b.id, 3900]].sort((x, y) => String(x[0]).localeCompare(String(y[0]))));
      const res = await post(`listings/${l.id}/restore`, { reason: 'mistake' });
      expect(res.status).toBe(409);
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: l.id } })).status).toBe('CANCELLED');
    });

    it('takedown with refunds on a free listing cancels every registration, telling each buyer why', async () => {
      const l = await listing((await merchant()).id, 'FREE');
      const r = await order(l, 'CONFIRMED');
      await post(`listings/${l.id}/takedown`, { reason: 'Unsafe venue', refundAll: true });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('CANCELLED');
      expect(await prisma.notificationOutbox.findFirstOrThrow({ where: { type: 'REGISTRATION_CANCELLED' } })).toMatchObject({
        recipient: r.buyerEmail,
        payload: expect.objectContaining({ reason: 'Unsafe venue' }),
      });
    });

    it('lists every merchant’s listings with filters, and 404s an unknown one', async () => {
      const a = await merchant({ displayName: 'A' });
      const b = await merchant({ displayName: 'B' });
      await listing(a.id);
      const free = await listing(b.id, 'FREE');
      expect((await get('listings')).body.items).toHaveLength(2);
      const byMerchant = await get(`listings?merchantId=${b.id}`);
      expect(byMerchant.body.items.map((l: { id: string; merchant: { displayName: string } }) => [l.id, l.merchant.displayName])).toEqual([[free.id, 'B']]);
      expect((await get('listings?pricing=FREE')).body.items).toHaveLength(1);
      expect((await get(`listings?q=${free.shortCode}`)).body.items).toHaveLength(1);
      expect((await get(`listings/${randomUUID()}`)).status).toBe(404);
      expect((await post(`listings/${randomUUID()}/takedown`, { reason: 'x', refundAll: false })).status).toBe(404);
      expect((await post(`listings/${randomUUID()}/restore`, { reason: 'x' })).status).toBe(404);
    });
  });

  describe('overview and disputes', () => {
    it('stats: new merchants today, 7- and 30-day GMV, open disputes', async () => {
      const old = await merchant();
      await merchant({ createdAt: new Date() });
      const l = await listing(old.id);
      await order(l, 'PAID', { paidAt: new Date(Date.now() - 2 * DAY), totalCents: 1_000 });
      const disputedOrder = await order(l, 'PAID', { paidAt: new Date(Date.now() - 20 * DAY), totalCents: 5_000 });
      await order(l, 'PAID', { paidAt: new Date(Date.now() - 40 * DAY), totalCents: 9_000 });
      await prisma.dispute.create({
        data: { id: 'dp_s1', orderId: disputedOrder.id, merchantId: old.id, amountCents: 5_000, reason: 'fraudulent', status: 'under_review', open: true, lastEventAt: new Date() },
      });
      // A merchant created at the start of the day counts as today's only if today in Auckland; this one is 60 days old.
      const stats = await get('stats');
      expect(stats.body).toEqual({ newMerchantsToday: 1, gmv7dCents: 1_000, gmv30dCents: 6_000, openDisputes: 1 });
    });

    it('disputes: newest first, filtered by open or closed', async () => {
      const m = await merchant();
      const l = await listing(m.id);
      const o1 = await order(l, 'PAID');
      const o2 = await order(l, 'PAID');
      await prisma.dispute.create({ data: { id: 'dp_a', orderId: o1.id, merchantId: m.id, amountCents: 3900, reason: 'fraudulent', status: 'lost', open: false, lastEventAt: new Date(), closedAt: new Date(), createdAt: new Date(Date.now() - DAY) } });
      await prisma.dispute.create({ data: { id: 'dp_b', orderId: o2.id, merchantId: m.id, amountCents: 3900, reason: 'duplicate', status: 'needs_response', open: true, lastEventAt: new Date() } });
      expect((await get('disputes')).body.map((d: { id: string }) => d.id)).toEqual(['dp_b', 'dp_a']);
      expect((await get('disputes?status=open')).body).toEqual([
        expect.objectContaining({ id: 'dp_b', open: true, orderPublicCode: o2.publicCode, listingTitle: 'Cherries', merchant: expect.objectContaining({ id: m.id }) }),
      ]);
      expect((await get('disputes?status=closed')).body.map((d: { id: string }) => d.id)).toEqual(['dp_a']);
      expect((await get('disputes?limit=1')).body.map((d: { id: string }) => d.id)).toEqual(['dp_b']);
      expect((await get('disputes?limit=0')).status).toBe(400);
    });
  });

  describe('audit', () => {
    it('every admin write leaves exactly one audit record with the admin, the target, the reason and the IP', async () => {
      const m = await merchant();
      const closing = await listing(m.id);
      const takingDown = await listing(m.id);
      const writes: { path: string; body: object; action: string; targetType: string; targetId: string; reason: string | null }[] = [
        { path: `merchants/${m.id}/suspend`, body: { reason: 'r1' }, action: 'MERCHANT_SUSPEND', targetType: 'merchant', targetId: m.id, reason: 'r1' },
        { path: `merchants/${m.id}/reinstate`, body: { reason: 'r2' }, action: 'MERCHANT_REINSTATE', targetType: 'merchant', targetId: m.id, reason: 'r2' },
        { path: `merchants/${m.id}/notes`, body: { note: 'n1' }, action: 'MERCHANT_NOTE', targetType: 'merchant', targetId: m.id, reason: null },
        { path: `listings/${closing.id}/close`, body: { reason: 'r3' }, action: 'LISTING_CLOSE', targetType: 'listing', targetId: closing.id, reason: 'r3' },
        { path: `listings/${takingDown.id}/takedown`, body: { reason: 'r4', refundAll: false }, action: 'LISTING_TAKEDOWN', targetType: 'listing', targetId: takingDown.id, reason: 'r4' },
        { path: `listings/${takingDown.id}/restore`, body: { reason: 'r5' }, action: 'LISTING_RESTORE', targetType: 'listing', targetId: takingDown.id, reason: 'r5' },
      ];
      for (const w of writes) {
        const before = await prisma.auditLog.count();
        const res = await post(w.path, w.body);
        expect([w.path, res.status]).toEqual([w.path, expect.any(Number)]);
        expect(res.status).toBeLessThan(300);
        const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 1 });
        expect(await prisma.auditLog.count()).toBe(before + 1);
        expect(rows[0]).toMatchObject({ actorUserId: adminId, actorRole: 'ADMIN', action: w.action, targetType: w.targetType, targetId: w.targetId, reason: w.reason });
        expect(rows[0].ip).toMatch(/127\.0\.0\.1|::1/);
      }
      expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'LISTING_TAKEDOWN' } })).metadata).toEqual({ refundAll: false });
    });

    it('a refused write leaves no audit record', async () => {
      const m = await merchant();
      await post(`merchants/${m.id}/reinstate`, { reason: 'not suspended' });
      const l = await listing(m.id);
      await post(`listings/${l.id}/restore`, { reason: 'not taken down' });
      expect(await prisma.auditLog.count()).toBe(0);
    });
  });
});
