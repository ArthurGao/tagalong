import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { PiiRetentionJob } from '../../src/modules/orders/pii-retention.job.js';
import { createTestApp, type TestApp } from './support/app.js';
import { resetDb, testPrisma } from './support/db.js';
import { createMerchant } from './support/factories.js';

const DAY = 86_400_000;
const monthsAgo = (n: number) => new Date(Date.now() - n * 30.5 * DAY);

describe('PII retention job (DESIGN §10: anonymised 12 months after the listing ended)', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  const run = () => t.app.get(PiiRetentionJob).run();

  beforeAll(async () => {
    t = await createTestApp();
    prisma = testPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await t.app.close();
  });

  beforeEach(() => resetDb(prisma));

  /** A listing in `status` that closed (or was cancelled) and stopped taking orders at `endedAt`, with sessions as given. */
  async function listing(status: 'CLOSED' | 'CANCELLED' | 'PUBLISHED', endedAt: Date, session?: { startsAt: Date; endsAt?: Date }) {
    const m = await createMerchant(prisma);
    const l = await prisma.listing.create({
      data: {
        merchantId: m.id,
        shortCode: randomUUID().slice(0, 8),
        title: 'Cherries',
        description: 'Fresh',
        type: session ? 'EVENT' : 'RETAIL',
        fulfilment: 'ONSITE',
        pricing: 'PAID',
        status,
        publishedAt: new Date(endedAt.getTime() - 30 * DAY),
        maxQtyPerOrder: 5,
        onePerEmail: false,
        allowSelfCancel: false,
        policyText: 'No refunds',
        options: { create: [{ name: '2kg', priceCents: 3900, capacity: 100, startsAt: session?.startsAt, endsAt: session?.endsAt }] },
      },
      include: { options: true },
    });
    const ended = status === 'CLOSED' ? { closedAt: endedAt } : status === 'CANCELLED' ? { cancelledAt: endedAt } : {};
    await prisma.listing.update({ where: { id: l.id }, data: { closesAt: endedAt, ...ended } });
    return l;
  }
  type Listing = Awaited<ReturnType<typeof listing>>;

  async function order(l: Listing, status: 'PAID' | 'REFUNDED' | 'PENDING_PAYMENT' = 'PAID') {
    return prisma.order.create({
      data: {
        publicCode: `TA-${randomUUID().slice(0, 6).toUpperCase()}`,
        accessToken: randomUUID(),
        listingId: l.id,
        merchantId: l.merchantId,
        buyerName: 'Amy Lee',
        buyerEmail: `amy-${randomUUID().slice(0, 6)}@example.test`,
        buyerPhone: '021 555 0101',
        buyerNote: 'Gate 4',
        formAnswers: { allergies: 'nuts' },
        isFree: false,
        status,
        subtotalCents: 3900,
        platformFeeCents: 0,
        totalCents: 3900,
        paidAt: status === 'PENDING_PAYMENT' ? null : new Date(),
        stripePaymentIntentId: status === 'PENDING_PAYMENT' ? null : `pi_${randomUUID().slice(0, 12)}`,
        items: { create: [{ optionId: l.options[0].id, quantity: 1, unitPriceCents: 3900, checkoutName: 'Cherries · 2kg', attendeeName: 'Amy', attendeeAnswers: [{ shirt: 'M' }] }] },
      },
    });
  }

  const anonymized = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).anonymizedAt !== null;

  it('anonymizes orders of listings that ended over 12 months ago, keeps money and status, and audits each batch', async () => {
    const closedLongAgo = await listing('CLOSED', monthsAgo(13));
    const cancelledLongAgo = await listing('CANCELLED', monthsAgo(14));
    const old = [await order(closedLongAgo), await order(closedLongAgo, 'REFUNDED'), await order(cancelledLongAgo)];
    const recent = await order(await listing('CLOSED', monthsAgo(11)));
    const stillOpen = await order(await listing('PUBLISHED', monthsAgo(13))); // never closed: not ended
    const lateSession = await order(await listing('CLOSED', monthsAgo(13), { startsAt: monthsAgo(11.5), endsAt: monthsAgo(11) }));

    expect(await run()).toBe(3);
    for (const before of old) {
      const after = await prisma.order.findUniqueOrThrow({ where: { id: before.id }, include: { items: true } });
      expect(after).toMatchObject({
        buyerName: 'Anonymized',
        buyerEmail: `${before.id}@anonymized.invalid`,
        buyerPhone: '',
        buyerNote: null,
        formAnswers: {},
        displayAnonymous: true,
        status: before.status,
        totalCents: 3900,
        anonymizedAt: expect.any(Date),
      });
      expect(after.accessToken).not.toBe(before.accessToken);
      expect(after.items[0]).toMatchObject({ attendeeName: null, attendeeAnswers: [] });
    }
    for (const kept of [recent, stillOpen, lateSession]) expect([kept.id, await anonymized(kept.id)]).toEqual([kept.id, false]);
    const audits = await prisma.auditLog.findMany({ where: { action: 'PII_RETENTION' } });
    expect(audits).toEqual([
      expect.objectContaining({ actorRole: 'SYSTEM', actorUserId: null, targetType: 'order', metadata: { orderCount: 3, orderIds: [...old.map((o) => o.id)].sort() } }),
    ]);
    expect(await run()).toBe(0); // nothing left: no second audit row
    expect(await prisma.auditLog.count()).toBe(1);
  });

  it('measures from when the listing closed, not its last change: stock moving later does not restart the clock', async () => {
    const l = await listing('CLOSED', monthsAgo(13));
    const o = await order(l);
    await prisma.$executeRaw`UPDATE listing SET updated_at = now() WHERE id = ${l.id}::uuid`; // a late refund released stock
    expect(await run()).toBe(1);
    expect(await anonymized(o.id)).toBe(true);
  });

  it('a listing reopened while the job runs keeps its orders: the end is checked again under the listing lock', async () => {
    const l = await listing('CLOSED', monthsAgo(13));
    const o = await order(l);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    // The merchant reopens it (as ListingsService.mutate: listing locked, then written); it commits once the job has looked.
    const reopening = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM listing WHERE id = ${l.id}::uuid FOR UPDATE`;
      await tx.listing.update({ where: { id: l.id }, data: { status: 'PUBLISHED', closedAt: null, closesAt: new Date(Date.now() + DAY) } });
      locked();
      await held;
    });
    await isLocked;
    const job = run();
    await new Promise((r) => setTimeout(r, 300));
    release();
    await reopening;
    expect(await job).toBe(0);
    expect(await anonymized(o.id)).toBe(false);
  });

  it('leaves orders in motion for a later day: awaiting payment, an open dispute, a refund in flight', async () => {
    const l = await listing('CLOSED', monthsAgo(13));
    const unpaid = await order(l, 'PENDING_PAYMENT');
    const disputed = await order(l);
    const refunding = await order(l);
    const settled = await order(l);
    await prisma.dispute.create({
      data: { id: 'dp_1', orderId: disputed.id, merchantId: l.merchantId, amountCents: 3900, reason: 'fraudulent', status: 'needs_response', open: true, lastEventAt: new Date() },
    });
    const task = await prisma.refundTask.create({ data: { orderId: refunding.id, amountCents: 100 } });

    expect(await run()).toBe(1);
    expect(await anonymized(settled.id)).toBe(true);
    for (const o of [unpaid, disputed, refunding]) expect([o.id, await anonymized(o.id)]).toEqual([o.id, false]);

    await prisma.dispute.update({ where: { id: 'dp_1' }, data: { open: false, status: 'won', closedAt: new Date() } });
    await prisma.refundTask.update({ where: { id: task.id }, data: { status: 'SUCCEEDED' } });
    expect(await run()).toBe(2);
    expect([await anonymized(disputed.id), await anonymized(refunding.id), await anonymized(unpaid.id)]).toEqual([true, true, false]);
  });

  it('drains more than one batch in a run', async () => {
    const l = await listing('CLOSED', monthsAgo(13));
    for (let n = 0; n < 205; n++) await order(l);
    expect(await run()).toBe(205);
    expect(await prisma.order.count({ where: { anonymizedAt: null } })).toBe(0);
    expect((await prisma.auditLog.findMany({ where: { action: 'PII_RETENTION' } })).map((a) => (a.metadata as { orderCount: number }).orderCount).sort()).toEqual([200, 5].sort());
  });

  it('erases emails older than the period, by age; recent and queued ones stay', async () => {
    await prisma.notificationOutbox.createMany({
      data: [
        { type: 'ORDER_CONFIRMED', recipient: 'old@example.test', locale: 'en', payload: { name: 'Amy' }, dedupeKey: 'ORDER_CONFIRMED:old', status: 'SENT', lastError: '421 old@example.test', createdAt: monthsAgo(13) },
        { type: 'ORDER_CONFIRMED', recipient: 'new@example.test', locale: 'en', payload: { name: 'Ben' }, dedupeKey: 'ORDER_CONFIRMED:new', status: 'SENT', createdAt: monthsAgo(11) },
        { type: 'ORDER_CONFIRMED', recipient: 'stuck@example.test', locale: 'en', payload: { name: 'Cy' }, dedupeKey: 'ORDER_CONFIRMED:stuck', status: 'PENDING', createdAt: monthsAgo(13) },
      ],
    });
    await run();
    const rows = await prisma.notificationOutbox.findMany({ orderBy: { recipient: 'asc' } });
    expect(rows.map((r) => [r.recipient, r.payload, r.lastError, r.dedupeKey.startsWith('ERASED:')])).toEqual([
      ['erased@anonymized.invalid', {}, null, true],
      ['new@example.test', { name: 'Ben' }, null, false],
      ['stuck@example.test', { name: 'Cy' }, null, false],
    ]);
  });
});
