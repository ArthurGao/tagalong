import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './support/app.js';
import { resetDb, testPrisma } from './support/db.js';
import { createMerchant } from './support/factories.js';

// DESIGN §11: the merchant previews a listing as buyers will see it before publishing.
describe('GET /merchants/me/listings/:id/preview', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  const http = () => request(t.app.getHttpServer());
  const as = (clerkUserId: string) => ({ authorization: `Bearer valid:${clerkUserId}` });

  beforeAll(async () => {
    t = await createTestApp();
    prisma = testPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await t.app.close();
  });

  beforeEach(() => resetDb(prisma));

  async function draft() {
    const merchant = await createMerchant(prisma, { clerkUserId: 'user_owner' });
    return prisma.listing.create({
      data: {
        merchantId: merchant.id,
        shortCode: randomUUID().slice(0, 8),
        title: 'Bread class',
        description: 'Bring an apron',
        type: 'EVENT',
        fulfilment: 'ONSITE',
        pricing: 'FREE',
        maxQtyPerOrder: 2,
        onePerEmail: true,
        allowSelfCancel: true,
        policyText: 'Cancel early',
        closesAt: new Date(Date.now() + 7 * 86_400_000),
        formFields: [{ key: 'q1', label: 'Child age', type: 'text', required: false, scope: 'order' }],
        options: { create: [{ name: 'Saturday', priceCents: 0, capacity: 6, location: 'Hall' }] },
      },
    });
  }

  it('shows the owner their draft as buyers will see it once published', async () => {
    const l = await draft();
    const res = await http().get(`/api/v1/merchants/me/listings/${l.id}/preview`).set(as('user_owner'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      shortCode: l.shortCode,
      title: 'Bread class',
      status: 'DRAFT',
      availability: 'OPEN',
      maxQtyPerOrder: 2,
      policyText: 'Cancel early',
      formFields: [{ key: 'q1', label: 'Child age' }],
      options: [{ name: 'Saturday', priceCents: 0, remaining: 6, location: 'Hall' }],
      joinedCount: 0,
    });
  });

  it('is the owner’s only: another merchant and a signed-out visitor get nothing, and the public API still hides the draft', async () => {
    const l = await draft();
    await createMerchant(prisma, { clerkUserId: 'user_other' });
    expect((await http().get(`/api/v1/merchants/me/listings/${l.id}/preview`).set(as('user_other'))).status).toBe(404);
    expect((await http().get(`/api/v1/merchants/me/listings/${l.id}/preview`)).status).toBe(401);
    expect((await http().get(`/api/v1/public/listings/${l.shortCode}`)).status).toBe(404);
  });
});
