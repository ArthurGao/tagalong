import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './support/app.js';
import { resetDb, testPrisma } from './support/db.js';
import { createMerchant } from './support/factories.js';
import { TURNSTILE_PASS } from './support/turnstile-fake.js';

const ORIGIN = 'http://localhost:3800';

// DESIGN §13: the internal trial runs on Stripe test keys with paid listings switched off (PAID_LISTINGS_ENABLED=false),
// so no buyer can "pay" with a test card. Free listings work as usual.
describe('PAID_LISTINGS_ENABLED=false', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  const http = () => request(t.app.getHttpServer());
  const as = (clerkUserId: string) => ({ authorization: `Bearer valid:${clerkUserId}` });
  const base = '/api/v1/merchants/me/listings';

  beforeAll(async () => {
    t = await createTestApp();
    prisma = testPrisma();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    t.stripe.reset();
    t.env.PAID_LISTINGS_ENABLED = false;
  });

  afterAll(async () => {
    t.env.PAID_LISTINGS_ENABLED = true;
    await prisma.$disconnect();
    await t.app.close();
  });

  /** A listing ready to publish, made directly (as if created while paid listings were on). */
  async function ready(merchantId: string, pricing: 'FREE' | 'PAID', status: 'DRAFT' | 'PUBLISHED' | 'CLOSED' = 'DRAFT') {
    return prisma.listing.create({
      data: {
        merchantId,
        shortCode: randomUUID().slice(0, 8),
        title: 'Kiwifruit',
        description: '',
        type: 'RETAIL',
        fulfilment: 'ONSITE',
        pricing,
        status,
        maxQtyPerOrder: 2,
        onePerEmail: false,
        allowSelfCancel: false,
        policyText: 'No refunds',
        options: { create: [{ name: '3kg', priceCents: pricing === 'PAID' ? 2990 : 0, capacity: 5 }] },
      },
      include: { options: true },
    });
  }

  const chargeable = (clerkUserId: string) =>
    createMerchant(prisma, { clerkUserId }).then((m) =>
      prisma.merchant.update({ where: { id: m.id }, data: { stripeAccountId: `acct_${m.id.slice(-8)}`, chargesEnabled: true } }),
    );

  it('refuses to create, publish or reopen a paid listing, and connecting Stripe', async () => {
    const merchant = await chargeable('user_m');
    const created = await http().post(base).set(as('user_m')).send({ title: 'Kiwifruit', pricing: 'PAID', type: 'RETAIL', fulfilment: 'ONSITE' });
    expect([created.status, created.body.code]).toEqual([409, 'PAID_LISTINGS_DISABLED']);

    const draft = await ready(merchant.id, 'PAID');
    const publish = await http().post(`${base}/${draft.id}/publish`).set(as('user_m'));
    expect([publish.status, publish.body.code]).toEqual([409, 'PAID_LISTINGS_DISABLED']);

    const closed = await ready(merchant.id, 'PAID', 'CLOSED');
    const reopen = await http().post(`${base}/${closed.id}/reopen`).set(as('user_m')).send({});
    expect([reopen.status, reopen.body.code]).toEqual([409, 'PAID_LISTINGS_DISABLED']);

    const onboard = await http().post('/api/v1/merchants/me/stripe/onboard').set(as('user_m'));
    expect([onboard.status, onboard.body.code]).toEqual([409, 'PAID_LISTINGS_DISABLED']);
    expect(t.stripe.accountKeys).toEqual([]);
    expect(await prisma.listing.count({ where: { status: 'PUBLISHED' } })).toBe(0);
  });

  it('refuses to turn a free draft paid', async () => {
    const merchant = await chargeable('user_m');
    const draft = await ready(merchant.id, 'FREE');
    const res = await http().patch(`${base}/${draft.id}`).set(as('user_m')).send({ pricing: 'PAID', revision: draft.revision });
    expect([res.status, res.body.code]).toEqual([409, 'PAID_LISTINGS_DISABLED']);
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: draft.id } })).pricing).toBe('FREE');
  });

  it('a checkout opened before the switch is not handed out again on a replay', async () => {
    const merchant = await chargeable('user_m');
    const l = await ready(merchant.id, 'PAID', 'PUBLISHED');
    const key = randomUUID();
    const send = () =>
      http()
        .post(`/api/v1/public/listings/${l.shortCode}/orders`)
        .set('Origin', ORIGIN)
        .set('Idempotency-Key', key)
        .send({
          items: [{ optionId: l.options[0].id, quantity: 1 }],
          buyer: { name: 'Amy Lee', email: 'amy@example.test', phone: '021 555 0101' },
          anonymous: false,
          turnstileToken: TURNSTILE_PASS,
        });
    t.env.PAID_LISTINGS_ENABLED = true;
    expect((await send()).body.kind).toBe('checkout');
    t.env.PAID_LISTINGS_ENABLED = false;
    const replay = await send();
    expect([replay.status, replay.body.code]).toEqual([409, 'PAID_LISTINGS_DISABLED']);
    expect(replay.body.checkoutUrl).toBeUndefined();
  });

  it('takes no order on a paid listing published before the switch, and opens no checkout', async () => {
    const merchant = await chargeable('user_m');
    const l = await ready(merchant.id, 'PAID', 'PUBLISHED');
    const res = await http()
      .post(`/api/v1/public/listings/${l.shortCode}/orders`)
      .set('Origin', ORIGIN)
      .set('Idempotency-Key', randomUUID())
      .send({
        items: [{ optionId: l.options[0].id, quantity: 1 }],
        buyer: { name: 'Amy Lee', email: 'amy@example.test', phone: '021 555 0101' },
        anonymous: false,
        turnstileToken: TURNSTILE_PASS,
      });
    expect([res.status, res.body.code]).toEqual([409, 'PAID_LISTINGS_DISABLED']);
    expect(t.stripe.sessions).toEqual([]);
    expect(await prisma.order.count()).toBe(0);
  });

  it('leaves free listings alone, and tells the dashboard paid listings are off', async () => {
    await createMerchant(prisma, { clerkUserId: 'user_f' });
    const created = await http().post(base).set(as('user_f')).send({ title: 'Bread class', pricing: 'FREE', type: 'RETAIL', fulfilment: 'ONSITE' });
    expect(created.status).toBe(201);
    expect((await http().get('/api/v1/merchants/me').set(as('user_f'))).body.paidListingsEnabled).toBe(false);
    t.env.PAID_LISTINGS_ENABLED = true;
    expect((await http().get('/api/v1/merchants/me').set(as('user_f'))).body.paidListingsEnabled).toBe(true);
  });
});
