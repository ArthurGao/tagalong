import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './support/app.js';
import { resetDb, testPrisma } from './support/db.js';
import { TURNSTILE_PASS } from './support/turnstile-fake.js';

describe('order rate limit per IP (DESIGN §10)', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  const previous = { limit: process.env.ORDER_RATE_LIMIT_PER_MINUTE, edge: process.env.EDGE_SECRET };

  beforeAll(async () => {
    process.env.ORDER_RATE_LIMIT_PER_MINUTE = '3'; // read when this file's app is built
    process.env.EDGE_SECRET = 'edge-test-secret';
    t = await createTestApp();
    prisma = testPrisma();
    await resetDb(prisma);
  });

  afterAll(async () => {
    process.env.ORDER_RATE_LIMIT_PER_MINUTE = previous.limit;
    if (previous.edge === undefined) delete process.env.EDGE_SECRET;
    else process.env.EDGE_SECRET = previous.edge;
    await prisma.$disconnect();
    await t.app.close();
  });

  const order = (headers: Record<string, string> = {}) =>
    request(t.app.getHttpServer())
      .post('/api/v1/public/listings/nope2345/orders')
      .set(headers)
      .set('Origin', 'http://localhost:3800')
      .set('Idempotency-Key', randomUUID())
      .send({ items: [{ optionId: randomUUID(), quantity: 1 }], buyer: { name: 'A', email: 'a@example.test', phone: '021 555 0101' }, anonymous: false, turnstileToken: TURNSTILE_PASS });

  it('answers 429 RATE_LIMITED after the per-minute limit, and only on order creation', async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await order()).status);
    expect(statuses).toEqual([404, 404, 404, 429]);
    const limited = await order();
    expect(limited.body.code).toBe('RATE_LIMITED');
    // Reading is not limited.
    expect((await request(t.app.getHttpServer()).get('/api/v1/public/listings/nope2345')).status).toBe(404);
  });

  it('behind our web app, each buyer IP has its own limit; a forged client IP without the secret shares the caller\'s', async () => {
    const via = (ip: string, secret = 'edge-test-secret') => order({ 'x-tagalong-edge': secret, 'x-tagalong-client-ip': ip });
    const a = [];
    for (let i = 0; i < 4; i++) a.push((await via('203.0.113.10')).status);
    expect(a).toEqual([404, 404, 404, 429]);
    expect((await via('203.0.113.11')).status).toBe(404); // another buyer behind the same proxy
    // A direct caller rotating made-up IPs without the secret is one caller: limited like any other.
    const forged = [];
    for (let i = 0; i < 4; i++) forged.push((await via(`198.51.100.${i}`, 'guess')).status);
    expect(forged.at(-1)).toBe(429);
  });
});
