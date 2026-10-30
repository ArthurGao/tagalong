import request from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { ListingCloseJob } from '../../src/modules/listings/listing-close.job.js';
import { createTestApp, type TestApp } from './support/app.js';
import { resetDb, testPrisma } from './support/db.js';
import { createFreeOrder, createMerchant } from './support/factories.js';

const DAY = 24 * 60 * 60 * 1000;
const future = (days: number) => new Date(Date.now() + days * DAY).toISOString();

describe('listings (DESIGN §5b, §9, M3)', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  const http = () => request(t.app.getHttpServer());
  const as = (clerkUserId: string) => ({ authorization: `Bearer valid:${clerkUserId}` });
  const base = '/api/v1/merchants/me/listings';

  async function newListing(
    clerkUserId: string,
    body: Record<string, unknown> = { pricing: 'PAID', type: 'RETAIL', fulfilment: 'PICKUP', title: '车厘子 2kg 接龙' },
  ) {
    const res = await http().post(base).set(as(clerkUserId)).send(body);
    expect(res.status).toBe(201);
    return res.body as { id: string; shortCode: string; status: string };
  }

  const revisionOf = async (id: string) => (await prisma.listing.findUniqueOrThrow({ where: { id } })).revision;
  const patch = async (clerkUserId: string, id: string, body: object) =>
    http().patch(`${base}/${id}`).set(as(clerkUserId)).send({ revision: await revisionOf(id), ...body });
  const put = async (clerkUserId: string, id: string, what: 'options' | 'pickup-points', body: object) =>
    http().put(`${base}/${id}/${what}`).set(as(clerkUserId)).send({ revision: await revisionOf(id), ...body });

  async function makeReady(clerkUserId: string, id: string, priceCents = 3900) {
    expect((await patch(clerkUserId, id, { policyText: 'No refunds after pickup', closesAt: future(7) })).status).toBe(200);
    expect((await put(clerkUserId, id, 'options', { options: [{ name: '2kg', priceCents, capacity: 30, active: true }] })).status).toBe(200);
    expect((await put(clerkUserId, id, 'pickup-points', { pickupPoints: [{ label: 'Albany', address: '1 Main St, Albany' }] })).status).toBe(200);
  }

  beforeAll(async () => {
    t = await createTestApp();
    prisma = testPrisma();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    await createMerchant(prisma, { clerkUserId: 'user_m' });
    await createMerchant(prisma, { clerkUserId: 'user_other' });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await t.app.close();
  });

  it('creates a DRAFT with an 8-character short code and type defaults', async () => {
    const free = await newListing('user_m', { pricing: 'FREE', type: 'EVENT', fulfilment: 'ONSITE', title: '社区讲座' });
    expect(free.status).toBe('DRAFT');
    expect(free.shortCode).toMatch(/^[a-z2-9]{8}$/);
    expect(free).toMatchObject({ onePerEmail: true, allowSelfCancel: true, maxQtyPerOrder: 1, remindBeforeHours: 24 });
    const list = await http().get(base).set(as('user_m'));
    expect(list.body.map((l: { id: string }) => l.id)).toEqual([free.id]);
  });

  it('M3 acceptance: a merchant publishes a paid listing once Stripe can charge', async () => {
    const { id } = await newListing('user_m');
    await makeReady('user_m', id);
    const blocked = await http().post(`${base}/${id}/publish`).set(as('user_m'));
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('MERCHANT_NOT_CHARGEABLE');

    await prisma.merchant.updateMany({ where: { owner: { clerkUserId: 'user_m' } }, data: { chargesEnabled: true } });
    const published = await http().post(`${base}/${id}/publish`).set(as('user_m'));
    expect(published.status).toBe(201);
    expect(published.body).toMatchObject({ status: 'PUBLISHED' });
    expect(published.body.publishedAt).toBeTruthy();
  });

  it('a free listing publishes without Stripe (D12) and gets a self-cancel deadline 2h before the session', async () => {
    const { id } = await newListing('user_m', { pricing: 'FREE', type: 'EVENT', fulfilment: 'ONSITE', title: '讲座' });
    const startsAt = new Date(Date.now() + 10 * DAY);
    expect((await patch('user_m', id, { policyText: 'Free', closesAt: future(9) })).status).toBe(200);
    const backwards = await put('user_m', id, 'options', {
      options: [{ name: 'Seat', priceCents: 0, capacity: 50, active: true, startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() - 60_000).toISOString() }],
    });
    expect(backwards.body).toMatchObject({ code: 'VALIDATION_FAILED', details: ['options.0.endsAt must be after startsAt'] });
    // The database refuses it from any other writer too.
    await expect(
      prisma.listingOption.create({ data: { listingId: id, name: 'Raw', priceCents: 0, capacity: 1, startsAt, endsAt: startsAt } }),
    ).rejects.toThrow(/listing_option_ends_after_start/);
    expect((await put('user_m', id, 'options', { options: [{ name: 'Seat', priceCents: 0, capacity: 50, active: true, startsAt: startsAt.toISOString() }] })).status).toBe(200);
    const res = await http().post(`${base}/${id}/publish`).set(as('user_m'));
    expect(res.status).toBe(201);
    expect(new Date(res.body.selfCancelUntil).getTime()).toBe(startsAt.getTime() - 2 * 60 * 60 * 1000);
  });

  it('lists what is missing when a listing is not ready', async () => {
    const { id } = await newListing('user_m', { pricing: 'FREE', type: 'RETAIL', fulfilment: 'PICKUP', title: 'Eggs' });
    const res = await http().post(`${base}/${id}/publish`).set(as('user_m'));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect([...res.body.details].sort()).toEqual(['options', 'pickupPoints', 'policyText']);
  });

  it('locks pricing after publish and audits option price changes without touching existing orders', async () => {
    const { id } = await newListing('user_m', { pricing: 'FREE', type: 'RETAIL', fulfilment: 'PICKUP', title: 'Eggs' });
    await makeReady('user_m', id, 0);
    await http().post(`${base}/${id}/publish`).set(as('user_m')).expect(201);

    const locked = await patch('user_m', id, { pricing: 'PAID' });
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('FIELD_LOCKED_AFTER_PUBLISH');

    const listing = await prisma.listing.findUniqueOrThrow({ where: { id }, include: { options: true } });
    const order = await createFreeOrder(prisma, listing, 'amy@example.test');
    await prisma.orderItem.create({ data: { orderId: order.id, optionId: listing.options[0].id, quantity: 1, unitPriceCents: 0, checkoutName: 'Fixture · item' } });

    const deleteWithOrders = await put('user_m', id, 'options', { options: [] });
    expect(deleteWithOrders.body.code).toBe('OPTION_HAS_ORDERS');

    const tooSmall = await put('user_m', id, 'options', { options: [{ id: listing.options[0].id, name: '2kg', priceCents: 0, capacity: 0, active: true }] });
    expect(tooSmall.body.code).toBe('VALIDATION_FAILED'); // capacity must be ≥ 1

    const deactivated = await put('user_m', id, 'options', { options: [{ id: listing.options[0].id, name: '2kg', priceCents: 0, capacity: 30, active: false }] });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.options[0]).toMatchObject({ id: listing.options[0].id, active: false });
  });

  it('audits a price change on a published paid listing; existing order items keep their snapshot', async () => {
    await prisma.merchant.updateMany({ where: { owner: { clerkUserId: 'user_m' } }, data: { chargesEnabled: true } });
    const { id } = await newListing('user_m');
    await makeReady('user_m', id, 3900);
    await http().post(`${base}/${id}/publish`).set(as('user_m')).expect(201);
    const listing = await prisma.listing.findUniqueOrThrow({ where: { id }, include: { options: true } });
    const optionId = listing.options[0].id;
    const order = await createFreeOrder(prisma, listing, 'amy@example.test');
    const item = await prisma.orderItem.create({ data: { orderId: order.id, optionId, quantity: 1, unitPriceCents: 3900, checkoutName: 'Fixture · item' } });

    expect((await put('user_m', id, 'options', { options: [{ id: optionId, name: '2kg', priceCents: 4200, capacity: 30, active: true }] })).status).toBe(200);

    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })).unitPriceCents).toBe(3900);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'LISTING_OPTION_PRICE_CHANGE' } });
    expect(audit).toMatchObject({ actorRole: 'MERCHANT', targetType: 'listing_option', targetId: optionId });
    expect(audit.metadata).toMatchObject({ fromCents: 3900, toCents: 4200, listingId: id });
  });

  it('keeps pickup points that orders use, and queues one notice per order when their address changes', async () => {
    const { id } = await newListing('user_m', { pricing: 'FREE', type: 'RETAIL', fulfilment: 'PICKUP', title: 'Eggs' });
    await makeReady('user_m', id, 0);
    const listing = await prisma.listing.findUniqueOrThrow({ where: { id }, include: { pickupPoints: true } });
    const point = listing.pickupPoints[0];
    const order = await createFreeOrder(prisma, listing, 'amy@example.test');
    await prisma.order.update({ where: { id: order.id }, data: { pickupPointId: point.id } });

    const removed = await put('user_m', id, 'pickup-points', { pickupPoints: [] });
    expect(removed.status).toBe(409);
    expect(removed.body.code).toBe('PICKUP_POINT_HAS_ORDERS');

    const moved = { id: point.id, label: 'Albany', address: '9 New Rd, Albany' };
    expect((await put('user_m', id, 'pickup-points', { pickupPoints: [moved] })).status).toBe(200);
    expect((await put('user_m', id, 'pickup-points', { pickupPoints: [moved] })).status).toBe(200);
    const notices = await prisma.notificationOutbox.findMany({ where: { type: 'PICKUP_POINT_CHANGED' } });
    expect(notices.map((n) => n.recipient)).toEqual(['amy@example.test']);
  });

  it('closes, reopens with a new deadline, and refuses to reopen into the past', async () => {
    const { id } = await newListing('user_m', { pricing: 'FREE', type: 'RETAIL', fulfilment: 'PICKUP', title: 'Eggs' });
    await makeReady('user_m', id, 0);
    await http().post(`${base}/${id}/publish`).set(as('user_m')).expect(201);
    const closed = await http().post(`${base}/${id}/close`).set(as('user_m'));
    expect(closed.body).toMatchObject({ status: 'CLOSED' });
    expect((await http().post(`${base}/${id}/close`).set(as('user_m'))).body.code).toBe('INVALID_STATE_TRANSITION');

    const past = await http().post(`${base}/${id}/reopen`).set(as('user_m')).send({ closesAt: new Date(Date.now() - DAY).toISOString() });
    expect(past.body.code).toBe('VALIDATION_FAILED');
    const reopened = await http().post(`${base}/${id}/reopen`).set(as('user_m')).send({ closesAt: future(3) });
    expect(reopened.body).toMatchObject({ status: 'PUBLISHED' });
  });

  it('auto-closes published listings whose closesAt has passed, within one job run', async () => {
    const { id } = await newListing('user_m', { pricing: 'FREE', type: 'RETAIL', fulfilment: 'PICKUP', title: 'Eggs' });
    await makeReady('user_m', id, 0);
    await http().post(`${base}/${id}/publish`).set(as('user_m')).expect(201);
    const { id: openId } = await newListing('user_m', { pricing: 'FREE', type: 'RETAIL', fulfilment: 'PICKUP', title: 'Milk' });
    await makeReady('user_m', openId, 0);
    await http().post(`${base}/${openId}/publish`).set(as('user_m')).expect(201);
    await prisma.listing.update({ where: { id }, data: { closesAt: new Date(Date.now() - 1000) } });

    expect(await t.app.get(ListingCloseJob).closeDue()).toBe(1);
    expect(await prisma.listing.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'CLOSED' });
    expect((await prisma.listing.findUniqueOrThrow({ where: { id } })).closedAt).not.toBeNull();
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: openId } })).status).toBe('PUBLISHED');
  });

  it("hides other merchants' listings", async () => {
    const { id } = await newListing('user_m');
    expect((await http().get(`${base}/${id}`).set(as('user_other'))).status).toBe(404);
    expect((await http().patch(`${base}/${id}`).set(as('user_other')).send({ revision: 0, title: 'x' })).status).toBe(404);
    expect((await http().get(base).set(as('user_other'))).body).toEqual([]);
  });

  it('accepts only images uploaded to our storage, and warns about sensitive form fields', async () => {
    const { id } = await newListing('user_m');
    const external = await patch('user_m', id, { images: ['https://evil.example/x.jpg'] });
    expect(external.status).toBe(400);
    const merchant = await prisma.merchant.findFirstOrThrow({ where: { owner: { clerkUserId: 'user_m' } } });
    const ours = `https://img.tagalong.test/listings/${merchant.id}/0192f0c0-0000-7000-8000-00000000abcd.webp`;
    const res = await patch('user_m', id, {
        images: [ours],
        formFields: [{ key: 'passport', label: 'Passport number', type: 'text', required: true, scope: 'attendee' }],
      });
    expect(res.status).toBe(200);
    expect(res.body.images).toEqual([ours]);
    expect(res.body.formFieldWarnings).toEqual(['passport']);
  });

  it('reopen only applies to CLOSED listings: a draft cannot skip the publish checks', async () => {
    const { id } = await newListing('user_m');
    const res = await http().post(`${base}/${id}/reopen`).set(as('user_m')).send({ closesAt: future(3) });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_STATE_TRANSITION');
    expect((await prisma.listing.findUniqueOrThrow({ where: { id } })).status).toBe('DRAFT');
  });

  it('reopen re-runs the merchant checks (suspended, Stripe charges for paid listings)', async () => {
    await prisma.merchant.updateMany({ where: { owner: { clerkUserId: 'user_m' } }, data: { chargesEnabled: true } });
    const { id } = await newListing('user_m');
    await makeReady('user_m', id);
    await http().post(`${base}/${id}/publish`).set(as('user_m')).expect(201);
    await http().post(`${base}/${id}/close`).set(as('user_m')).expect(201);

    await prisma.merchant.updateMany({ where: { owner: { clerkUserId: 'user_m' } }, data: { chargesEnabled: false } });
    expect((await http().post(`${base}/${id}/reopen`).set(as('user_m')).send({ closesAt: future(3) })).body.code).toBe(
      'MERCHANT_NOT_CHARGEABLE',
    );
    await prisma.merchant.updateMany({ where: { owner: { clerkUserId: 'user_m' } }, data: { chargesEnabled: true, status: 'SUSPENDED' } });
    expect((await http().post(`${base}/${id}/reopen`).set(as('user_m')).send({ closesAt: future(3) })).body.code).toBe(
      'MERCHANT_SUSPENDED',
    );
  });

  it('rejects edits made against an older revision (LISTING_STALE) and bumps the revision on every change', async () => {
    const { id } = await newListing('user_m', { pricing: 'FREE', type: 'RETAIL', fulfilment: 'PICKUP', title: 'Eggs' });
    const seen = await revisionOf(id);
    await makeReady('user_m', id, 0);
    expect(await revisionOf(id)).toBe(seen + 3);
    await http().post(`${base}/${id}/publish`).set(as('user_m')).expect(201);
    expect(await revisionOf(id)).toBe(seen + 4);

    const stale = await http().patch(`${base}/${id}`).set(as('user_m')).send({ revision: seen, pricing: 'PAID' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('LISTING_STALE');
    expect((await prisma.listing.findUniqueOrThrow({ where: { id } })).pricing).toBe('FREE');
  });

  it('of two concurrent option saves from the same revision, exactly one wins and nothing is lost silently', async () => {
    const { id } = await newListing('user_m');
    const revision = await revisionOf(id);
    const save = (name: string) =>
      http()
        .put(`${base}/${id}/options`)
        .set(as('user_m'))
        .send({ revision, options: [{ name, priceCents: 3900, capacity: 10, active: true }] });
    const results = await Promise.all([save('A'), save('B')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results.find((r) => r.status === 200)!.body.options.map((o: { name: string }) => o.name);
    const stored = await prisma.listingOption.findMany({ where: { listingId: id } });
    expect(stored.map((o) => o.name)).toEqual(winner);
  });

  it('auto-close bumps the revision, so an editor who loaded the open listing must reload', async () => {
    const { id } = await newListing('user_m', { pricing: 'FREE', type: 'RETAIL', fulfilment: 'PICKUP', title: 'Eggs' });
    await makeReady('user_m', id, 0);
    await http().post(`${base}/${id}/publish`).set(as('user_m')).expect(201);
    const seen = await revisionOf(id);
    await prisma.listing.update({ where: { id }, data: { closesAt: new Date(Date.now() - 1000) } });
    await t.app.get(ListingCloseJob).closeDue();
    expect(await revisionOf(id)).toBe(seen + 1);
  });

  it('rejects image URLs that only look like they are in the merchant folder', async () => {
    const { id } = await newListing('user_m');
    const merchant = await prisma.merchant.findFirstOrThrow({ where: { owner: { clerkUserId: 'user_m' } } });
    const other = await prisma.merchant.findFirstOrThrow({ where: { owner: { clerkUserId: 'user_other' } } });
    const uuid = '0192f0c0-0000-7000-8000-00000000abcd';
    for (const url of [
      `https://img.tagalong.test/listings/${merchant.id}/../${other.id}/${uuid}.webp`,
      `https://img.tagalong.test/listings/${merchant.id}/${uuid}.webp?x=1`,
      `https://img.tagalong.test/listings/${merchant.id}/sub/${uuid}.webp`,
      `https://img.tagalong.test/listings/${merchant.id}/not-a-uuid.webp`,
      `https://img.tagalong.test.evil.example/listings/${merchant.id}/${uuid}.webp`,
    ]) {
      expect((await patch('user_m', id, { images: [url] })).status, url).toBe(400);
    }
  });

  it('presigns image uploads for allowed types up to 5 MB, signing the exact size', async () => {
    const merchant = await prisma.merchant.findFirstOrThrow({ where: { owner: { clerkUserId: 'user_m' } } });
    const presign = (body: object) => http().post('/api/v1/uploads/presign').set(as('user_m')).send(body);
    const ok = await presign({ contentType: 'image/webp', contentLength: 120_000 });
    expect(ok.status).toBe(201);
    expect(ok.body.publicUrl).toMatch(new RegExp(`^https://img\\.tagalong\\.test/listings/${merchant.id}/[0-9a-f-]+\\.webp$`));
    expect(ok.body.uploadUrl).toContain('signed');
    expect(t.storage.presigned.at(-1)).toMatchObject({ contentType: 'image/webp', contentLength: 120_000 });
    expect((await presign({ contentType: 'image/gif', contentLength: 1000 })).status).toBe(400);
    expect((await presign({ contentType: 'image/png', contentLength: 5 * 1024 * 1024 + 1 })).status).toBe(400);
  });
});
