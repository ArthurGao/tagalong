import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './support/app.js';
import { resetDb, testPrisma } from './support/db.js';
import { TURNSTILE_PASS } from './support/turnstile-fake.js';

describe('order rate limit per IP (DESIGN §10)', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  const previous = process.env.ORDER_RATE_LIMIT_PER_MINUTE;

  beforeAll(async () => {
    process.env.ORDER_RATE_LIMIT_PER_MINUTE = '3'; // read when this file's app is built
    t = await createTestApp();
    prisma = testPrisma();
    await resetDb(prisma);
  });

  afterAll(async () => {
    process.env.ORDER_RATE_LIMIT_PER_MINUTE = previous;
    await prisma.$disconnect();
    await t.app.close();
  });

  const order = () =>
    request(t.app.getHttpServer())
      .post('/api/v1/public/listings/nope2345/orders')
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
});
