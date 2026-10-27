import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { OrderStatus } from '../../src/generated/prisma/enums.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './support/app.js';
import { resetDb, testPrisma } from './support/db.js';
import { createMerchant } from './support/factories.js';

const SECRET_EMAIL = 'secret.buyer@example.test';
const SECRET_PHONE = '+64 21 999 0000';
const SECRET_ANSWER = 'allergic-to-peanuts';

describe('public listing API (DESIGN §9, §10, M4)', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  const http = () => request(t.app.getHttpServer());

  async function publishedListing(over: { showParticipants?: boolean; totalCapacity?: number | null } = {}) {
    const merchant = await createMerchant(prisma);
    const listing = await prisma.listing.create({
      data: {
        merchantId: merchant.id,
        shortCode: randomUUID().slice(0, 8),
        title: '车厘子 2kg 接龙',
        description: '**新鲜**到货',
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
        showParticipants: over.showParticipants ?? true,
        totalCapacity: over.totalCapacity ?? null,
        formFields: [{ key: 'note', label: 'Allergies', type: 'text', required: false, scope: 'order' }],
        options: {
          create: [
            { name: '2kg', priceCents: 3900, capacity: 30, soldCount: 20, reservedCount: 3, sortOrder: 0 },
            { name: '5kg', priceCents: 8900, capacity: null, soldCount: 3, sortOrder: 1 },
            { name: 'Old', priceCents: 1000, capacity: 5, active: false, sortOrder: 2 },
          ],
        },
        pickupPoints: { create: [{ label: 'Albany', address: '1 Main St, Albany' }] },
        soldCount: 23,
        reservedCount: 3, // kept equal to the options' counters, as the reservation path does
      },
      include: { options: true },
    });
    return { merchant, listing };
  }

  let seq = 0;
  async function order(
    listing: { id: string; merchantId: string; options: { id: string; name: string }[] },
    buyerName: string,
    status: OrderStatus,
    over: { anonymous?: boolean; items?: [number, number][] } = {},
  ) {
    seq += 1;
    return prisma.order.create({
      data: {
        publicCode: `TA-${randomUUID().slice(0, 6)}`,
        accessToken: randomUUID(),
        listingId: listing.id,
        merchantId: listing.merchantId,
        buyerName,
        buyerEmail: SECRET_EMAIL,
        buyerPhone: SECRET_PHONE,
        buyerNote: SECRET_ANSWER,
        formAnswers: { note: SECRET_ANSWER },
        displayAnonymous: over.anonymous ?? false,
        isFree: false,
        status,
        subtotalCents: 3900,
        platformFeeCents: 117,
        totalCents: 3900,
        sequenceNo: seq,
        paidAt: new Date(Date.UTC(2026, 9, 1, 0, seq)),
        items: {
          create: (over.items ?? [[0, 1]]).map(([i, quantity]) => ({
            optionId: listing.options[i].id,
            quantity,
            unitPriceCents: 3900,
            attendeeName: 'Child Secret',
            attendeeAnswers: [{ age: SECRET_ANSWER }],
          })),
        },
      },
    });
  }

  beforeAll(async () => {
    t = await createTestApp();
    prisma = testPrisma();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    seq = 0;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await t.app.close();
  });

  it('serves a published listing with remaining places and only public fields', async () => {
    const { listing, merchant } = await publishedListing({ totalCapacity: 40 });
    const res = await http().get(`/api/v1/public/listings/${listing.shortCode}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      shortCode: listing.shortCode,
      title: '车厘子 2kg 接龙',
      pricing: 'PAID',
      availability: 'OPEN',
      joinedCount: 23,
      totalCapacity: 40,
      totalRemaining: 14, // 40 − 23 sold − 3 reserved
      merchant: { slug: merchant.slug, displayName: 'Test merchant', verified: false },
      pickupPoints: [{ label: 'Albany', address: '1 Main St, Albany' }],
      formFields: [{ key: 'note', label: 'Allergies', type: 'text', required: false, scope: 'order' }],
    });
    expect(res.body.options.map((o: { name: string; remaining: number | null }) => [o.name, o.remaining])).toEqual([
      ['2kg', 7],
      ['5kg', null],
    ]);
    const json = JSON.stringify(res.body);
    for (const leak of [listing.id, merchant.id, merchant.contactEmail, merchant.contactPhone]) {
      expect(json).not.toContain(leak);
    }
  });

  it('hides drafts and unknown codes', async () => {
    const { listing } = await publishedListing();
    await prisma.listing.update({ where: { id: listing.id }, data: { status: 'DRAFT' } });
    expect((await http().get(`/api/v1/public/listings/${listing.shortCode}`)).status).toBe(404);
    expect((await http().get('/api/v1/public/listings/nope2345')).status).toBe(404);
  });

  it('reports suspended merchants, taken-down listings and verified merchants', async () => {
    const { listing, merchant } = await publishedListing();
    const get = async () => (await http().get(`/api/v1/public/listings/${listing.shortCode}`)).body;
    await prisma.merchant.update({ where: { id: merchant.id }, data: { chargesEnabled: true } });
    expect((await get()).merchant.verified).toBe(true);
    await prisma.merchant.update({ where: { id: merchant.id }, data: { status: 'SUSPENDED' } });
    expect((await get()).availability).toBe('SUSPENDED');
    await prisma.listing.update({ where: { id: listing.id }, data: { status: 'CANCELLED', takenDownAt: new Date() } });
    expect((await get()).availability).toBe('TAKEN_DOWN');
  });

  it('serves none of a taken-down listing\'s content, and no sign-up sheet (admins cannot edit, only take down)', async () => {
    const { listing } = await publishedListing();
    await order(listing, 'Arthur Gao', 'PAID');
    await prisma.listing.update({ where: { id: listing.id }, data: { status: 'CANCELLED', takenDownAt: new Date() } });
    const res = await http().get(`/api/v1/public/listings/${listing.shortCode}`).expect(200);
    expect(res.body).toMatchObject({
      shortCode: listing.shortCode,
      availability: 'TAKEN_DOWN',
      title: '',
      description: '',
      policyText: '',
      images: [],
      options: [],
      pickupPoints: [],
      formFields: [],
      showParticipants: false,
    });
    expect(JSON.stringify(res.body)).not.toContain(listing.title);
    expect((await http().get(`/api/v1/public/listings/${listing.shortCode}/participants`)).status).toBe(404);
  });

  it('lists participants newest first, masked, without cancelled orders, with cursor paging', async () => {
    const { listing } = await publishedListing();
    await order(listing, 'Arthur Gao', 'PAID', { items: [[0, 1], [1, 2]] });
    await order(listing, '高阳', 'FULFILLED');
    await order(listing, 'Someone', 'CANCELLED');
    await order(listing, 'Lily Chen', 'PAID', { anonymous: true });
    await order(listing, 'Wei Zhang', 'PARTIALLY_REFUNDED');

    const first = await http().get(`/api/v1/public/listings/${listing.shortCode}/participants?limit=2`);
    expect(first.status).toBe(200);
    expect(first.body.items).toEqual([
      { seq: 5, displayName: 'Wei Z.', anonymous: false, summary: '2kg ×1', joinedAt: '2026-10-01T00:05:00.000Z' },
      { seq: 4, displayName: null, anonymous: true, summary: '2kg ×1', joinedAt: '2026-10-01T00:04:00.000Z' },
    ]);
    expect(first.body.nextCursor).toBe(4);

    const rest = await http().get(`/api/v1/public/listings/${listing.shortCode}/participants?limit=2&cursor=4`);
    expect(rest.body.items.map((p: { seq: number; displayName: string }) => [p.seq, p.displayName])).toEqual([
      [2, '高*'],
      [1, 'Arthur G.'],
    ]);
    expect(rest.body.items[1].summary).toBe('2kg ×1, 5kg ×2');
    expect(rest.body.nextCursor).toBeNull();
  });

  it('never returns buyer PII on any public route', async () => {
    const { listing } = await publishedListing();
    await order(listing, 'Arthur Gao', 'PAID');
    const bodies = [
      await http().get(`/api/v1/public/listings/${listing.shortCode}`),
      await http().get(`/api/v1/public/listings/${listing.shortCode}/participants`),
    ].map((r) => JSON.stringify(r.body));
    for (const body of bodies) {
      for (const secret of [SECRET_EMAIL, SECRET_PHONE, SECRET_ANSWER, 'Child Secret', 'Gao', 'accessToken', 'publicCode']) {
        expect(body).not.toContain(secret);
      }
    }
  });

  it('keeps the list private when the merchant turned it off', async () => {
    const { listing } = await publishedListing({ showParticipants: false });
    await order(listing, 'Arthur Gao', 'PAID');
    expect((await http().get(`/api/v1/public/listings/${listing.shortCode}/participants`)).status).toBe(404);
  });
});
