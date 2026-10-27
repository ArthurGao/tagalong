import request from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './support/app.js';
import { resetDb, testPrisma } from './support/db.js';

const profile = {
  slug: 'xiaolin-farm',
  displayName: '小林的果园',
  contactEmail: 'hello@xiaolin.test',
  contactPhone: '+64 21 123 4567',
};

describe('merchant profile', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  const http = () => request(t.app.getHttpServer());
  const as = (clerkUserId: string) => ({ authorization: `Bearer valid:${clerkUserId}` });

  beforeAll(async () => {
    t = await createTestApp();
    prisma = testPrisma();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    t.clerk.users.clear();
    t.clerk.users.set('user_a', 'a@example.test');
    t.clerk.users.set('user_b', 'b@example.test');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await t.app.close();
  });

  it('M1 acceptance: first request creates the user, then the merchant profile', async () => {
    expect((await http().get('/api/v1/me').set(as('user_a'))).body.hasMerchantProfile).toBe(false);
    expect((await http().get('/api/v1/merchants/me').set(as('user_a'))).status).toBe(404);

    const created = await http().post('/api/v1/merchants').set(as('user_a')).send(profile);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      ...profile,
      status: 'ACTIVE',
      chargesEnabled: false,
      description: null,
      gstNumber: null,
    });
    expect(created.body).not.toHaveProperty('ownerUserId');

    expect((await http().get('/api/v1/me').set(as('user_a'))).body.hasMerchantProfile).toBe(true);
    expect((await http().get('/api/v1/merchants/me').set(as('user_a'))).body.slug).toBe('xiaolin-farm');
  });

  it('a second profile for the same account is MERCHANT_PROFILE_EXISTS', async () => {
    await http().post('/api/v1/merchants').set(as('user_a')).send(profile);
    const res = await http().post('/api/v1/merchants').set(as('user_a')).send({ ...profile, slug: 'other-slug' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MERCHANT_PROFILE_EXISTS');
  });

  it('a slug used by another merchant is SLUG_TAKEN', async () => {
    await http().post('/api/v1/merchants').set(as('user_a')).send(profile);
    const res = await http().post('/api/v1/merchants').set(as('user_b')).send(profile);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SLUG_TAKEN');
    expect(await prisma.merchant.count()).toBe(1);
  });

  it.each([
    ['too short', 'ab'],
    ['uppercase', 'Xiaolin'],
    ['leading hyphen', '-xiaolin'],
    ['trailing hyphen', 'xiaolin-'],
    ['spaces', 'xiao lin'],
    ['too long', 'a'.repeat(31)],
  ])('rejects a slug that is %s', async (_case, slug) => {
    const res = await http().post('/api/v1/merchants').set(as('user_a')).send({ ...profile, slug });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('rejects an invalid contact email and unknown fields', async () => {
    const res = await http()
      .post('/api/v1/merchants')
      .set(as('user_a'))
      .send({ ...profile, contactEmail: 'not-an-email', chargesEnabled: true });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([expect.stringContaining('contactEmail'), expect.stringContaining('chargesEnabled')]),
    );
  });

  it('PATCH updates the profile but never the slug', async () => {
    await http().post('/api/v1/merchants').set(as('user_a')).send(profile);
    const res = await http()
      .patch('/api/v1/merchants/me')
      .set(as('user_a'))
      .send({ displayName: 'Xiaolin Orchard', gstNumber: '123-456-789' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ displayName: 'Xiaolin Orchard', gstNumber: '123-456-789', slug: 'xiaolin-farm' });

    const slugChange = await http().patch('/api/v1/merchants/me').set(as('user_a')).send({ slug: 'new-slug' });
    expect(slugChange.status).toBe(400);
  });

  it('admins cannot create merchant profiles (one role per account)', async () => {
    await prisma.user.create({ data: { email: 'ops@example.test', clerkUserId: 'user_ops', role: 'ADMIN' } });
    const res = await http().post('/api/v1/merchants').set(as('user_ops')).send(profile);
    expect(res.status).toBe(403);
  });
});
