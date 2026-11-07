import request from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './support/app.js';
import { resetDb, testPrisma } from './support/db.js';
import { createMerchant } from './support/factories.js';
import { signStripeEvent } from './support/stripe-fake.js';

const CONNECT_SECRET = 'whsec_test_connect';
const PLATFORM_SECRET = 'whsec_test_platform';

describe('Stripe Connect (DESIGN §8.1, §8.3)', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  const http = () => request(t.app.getHttpServer());
  const as = (clerkUserId: string) => ({ authorization: `Bearer valid:${clerkUserId}` });

  const merchantFor = (clerkUserId: string, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') =>
    createMerchant(prisma, { clerkUserId, status });

  function deliver(path: 'connect' | 'platform', event: object, secret = path === 'connect' ? CONNECT_SECRET : PLATFORM_SECRET) {
    const { body, signature } = signStripeEvent(event, secret);
    return http()
      .post(`/api/v1/webhooks/stripe/${path}`)
      .set('content-type', 'application/json')
      .set('stripe-signature', signature)
      .send(body);
  }

  const accountUpdated = (id: string, account: string) => ({
    id,
    object: 'event',
    type: 'account.updated',
    account,
    // Deliberately stale: the handler must read the live account from Stripe instead.
    data: { object: { id: account, object: 'account', charges_enabled: false, payouts_enabled: false, details_submitted: false } },
  });

  beforeAll(async () => {
    t = await createTestApp();
    prisma = testPrisma();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    t.stripe.reset();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await t.app.close();
  });

  describe('POST /merchants/me/stripe/onboard', () => {
    it('creates one connected account and returns a fresh onboarding link each time', async () => {
      const merchant = await merchantFor('user_a');
      const first = await http().post('/api/v1/merchants/me/stripe/onboard').set(as('user_a'));
      const second = await http().post('/api/v1/merchants/me/stripe/onboard').set(as('user_a'));
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(t.stripe.createdFor).toEqual([merchant.id]);
      const { stripeAccountId } = await prisma.merchant.findUniqueOrThrow({ where: { id: merchant.id } });
      expect(stripeAccountId).toMatch(/^acct_/);
      expect(first.body.url).toBe(`https://connect.stripe.test/setup/${stripeAccountId}`);
      expect((await http().get('/api/v1/merchants/me').set(as('user_a'))).body.stripeConnected).toBe(true);
      expect(t.stripe.links[0]).toEqual({
        accountId: stripeAccountId,
        refreshUrl: 'http://localhost:3800/dashboard/onboarding?expired=1',
        returnUrl: 'http://localhost:3800/dashboard/onboarding/return',
      });
    });

    it('after Stripe refuses an account, the next try uses a new key, so fixing the cause works at once', async () => {
      // Stripe keeps a key's first answer for 24 h, a refusal included (found when Connect was enabled after a try).
      const merchant = await merchantFor('user_a');
      t.stripe.rejectAccounts = true;
      expect((await http().post('/api/v1/merchants/me/stripe/onboard').set(as('user_a'))).status).toBe(502);
      t.stripe.rejectAccounts = false;
      const res = await http().post('/api/v1/merchants/me/stripe/onboard').set(as('user_a'));
      expect(res.status).toBe(201);
      expect(t.stripe.accountKeys).toEqual([`connect-account:${merchant.id}`, `connect-account:${merchant.id}:1`]);
      expect(t.stripe.accountLookups).toEqual([]); // a refusal made nothing, so nothing to look for
      const { stripeAccountId } = await prisma.merchant.findUniqueOrThrow({ where: { id: merchant.id } });
      expect(res.body.url).toBe(`https://connect.stripe.test/setup/${stripeAccountId}`);
    });

    it('after a lost response, the retry gets back the account Stripe already made, and the key stays', async () => {
      const merchant = await merchantFor('user_a');
      t.stripe.loseNextAccountResponse = true;
      expect((await http().post('/api/v1/merchants/me/stripe/onboard').set(as('user_a'))).status).toBe(502);
      const row = await prisma.merchant.findUniqueOrThrow({ where: { id: merchant.id } });
      expect(row.stripeAccountAttempt).toBe(0); // not a refusal: the next create would reuse the key
      expect(row.stripeAccountCreateStartedAt).not.toBeNull();
      t.stripe.loseNextAccountResponse = true; // lost again: the mark keeps the first try's time, so its age means something
      expect((await http().post('/api/v1/merchants/me/stripe/onboard').set(as('user_a'))).status).toBe(502);
      const again = await prisma.merchant.findUniqueOrThrow({ where: { id: merchant.id } });
      expect(again.stripeAccountCreateStartedAt).toEqual(row.stripeAccountCreateStartedAt);
      expect((await http().post('/api/v1/merchants/me/stripe/onboard').set(as('user_a'))).status).toBe(201);
      expect(t.stripe.accountKeys).toEqual(Array(3).fill(`connect-account:${merchant.id}`));
      expect(t.stripe.createdFor).toEqual([merchant.id]); // one account, not two
      expect(t.stripe.accountLookups).toEqual([]); // within the key's life the key replays it; no account list
      const stored = await prisma.merchant.findUniqueOrThrow({ where: { id: merchant.id } });
      expect(stored.stripeAccountCreateStartedAt).toBeNull();
    });

    it('after a lost response and a day gone (the key forgotten), the retry finds the account instead of making a second', async () => {
      const merchant = await merchantFor('user_a');
      t.stripe.loseNextAccountResponse = true;
      expect((await http().post('/api/v1/merchants/me/stripe/onboard').set(as('user_a'))).status).toBe(502);
      expect(t.stripe.accountLookups).toEqual([]); // a first try never searches
      // A day later: the mark is old and Stripe has forgotten the key (it keeps keys for 24 h).
      await prisma.merchant.update({ where: { id: merchant.id }, data: { stripeAccountCreateStartedAt: new Date(Date.now() - 24 * 3_600_000) } });
      t.stripe.keysExpired = true;
      const res = await http().post('/api/v1/merchants/me/stripe/onboard').set(as('user_a'));
      expect(res.status).toBe(201);
      expect(t.stripe.createdFor).toEqual([merchant.id]); // still one account
      expect(t.stripe.accountLookups).toEqual([merchant.id]);
      const { stripeAccountId } = await prisma.merchant.findUniqueOrThrow({ where: { id: merchant.id } });
      expect(res.body.url).toBe(`https://connect.stripe.test/setup/${stripeAccountId}`);
      expect(t.stripe.accounts.has(stripeAccountId!)).toBe(true);
    });

    it('is NOT_FOUND without a merchant profile and MERCHANT_SUSPENDED for a suspended merchant', async () => {
      await prisma.user.create({ data: { email: 'new@example.test', clerkUserId: 'user_new' } });
      expect((await http().post('/api/v1/merchants/me/stripe/onboard').set(as('user_new'))).status).toBe(404);
      await merchantFor('user_s', 'SUSPENDED');
      const res = await http().post('/api/v1/merchants/me/stripe/onboard').set(as('user_s'));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('MERCHANT_SUSPENDED');
      expect(t.stripe.createdFor).toEqual([]);
    });
  });

  describe('GET /merchants/me/stripe/status', () => {
    it('reports not connected before onboarding without calling Stripe', async () => {
      await merchantFor('user_a');
      const res = await http().get('/api/v1/merchants/me/stripe/status').set(as('user_a'));
      expect(res.body).toMatchObject({ stripeConnected: false, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false });
      expect(t.stripe.retrieveCalls).toEqual([]);
    });

    it('reads the live account from Stripe and stores it', async () => {
      const merchant = await merchantFor('user_a');
      await http().post('/api/v1/merchants/me/stripe/onboard').set(as('user_a'));
      const { stripeAccountId } = await prisma.merchant.findUniqueOrThrow({ where: { id: merchant.id } });
      t.stripe.accounts.set(stripeAccountId!, { chargesEnabled: true, payoutsEnabled: false, detailsSubmitted: true });
      const res = await http().get('/api/v1/merchants/me/stripe/status').set(as('user_a'));
      expect(res.body).toMatchObject({ stripeConnected: true, chargesEnabled: true, payoutsEnabled: false, detailsSubmitted: true });
      expect(await prisma.merchant.findUniqueOrThrow({ where: { id: merchant.id } })).toMatchObject({
        chargesEnabled: true,
        detailsSubmitted: true,
        status: 'ACTIVE',
      });
    });
  });

  it('concurrent syncs of one account apply Stripe states in order (a slow stale read cannot win)', async () => {
    const merchant = await merchantFor('user_a');
    await http().post('/api/v1/merchants/me/stripe/onboard').set(as('user_a'));
    const { stripeAccountId } = await prisma.merchant.findUniqueOrThrow({ where: { id: merchant.id } });
    const account = stripeAccountId!;
    t.stripe.accounts.set(account, { chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true });
    t.stripe.retrieveDelays.push(300); // request A reads "enabled", then stalls

    const statusA = http().get('/api/v1/merchants/me/stripe/status').set(as('user_a')).then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Stripe disables the account; request B reads the newer state.
    t.stripe.accounts.set(account, { chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: true });
    const statusB = http().get('/api/v1/merchants/me/stripe/status').set(as('user_a')).then((r) => r);
    await Promise.all([statusA, statusB]);

    expect(await prisma.merchant.findUniqueOrThrow({ where: { id: merchant.id } })).toMatchObject({
      chargesEnabled: false,
      payoutsEnabled: false,
    });
  });

  describe('webhooks', () => {
    async function onboarded() {
      const merchant = await merchantFor('user_a');
      await http().post('/api/v1/merchants/me/stripe/onboard').set(as('user_a'));
      const { stripeAccountId } = await prisma.merchant.findUniqueOrThrow({ where: { id: merchant.id } });
      t.stripe.accounts.set(stripeAccountId!, { chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true });
      return { merchantId: merchant.id, account: stripeAccountId! };
    }

    it('rejects a bad signature, and an event signed for the other endpoint', async () => {
      const { account } = await onboarded();
      expect((await deliver('connect', accountUpdated('evt_1', account), 'whsec_wrong')).status).toBe(400);
      expect((await deliver('platform', accountUpdated('evt_1', account), CONNECT_SECRET)).status).toBe(400);
      expect(await prisma.stripeEvent.count()).toBe(0);
    });

    it('account.updated syncs the live account state, not the stale payload', async () => {
      const { merchantId, account } = await onboarded();
      expect((await deliver('connect', accountUpdated('evt_2', account))).status).toBe(200);
      expect(await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } })).toMatchObject({
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      });
      expect((await prisma.stripeEvent.findUniqueOrThrow({ where: { id: 'evt_2' } })).processedAt).not.toBeNull();
    });

    it('processes a redelivered event once', async () => {
      const { account } = await onboarded();
      t.stripe.retrieveCalls.length = 0;
      await deliver('connect', accountUpdated('evt_3', account));
      await deliver('connect', accountUpdated('evt_3', account));
      expect(t.stripe.retrieveCalls).toEqual([account]);
    });

    it('returns 500 when processing fails and processes the retry', async () => {
      const { merchantId, account } = await onboarded();
      t.stripe.failNextRetrieve = true;
      expect((await deliver('connect', accountUpdated('evt_4', account))).status).toBe(500);
      expect((await prisma.stripeEvent.findUniqueOrThrow({ where: { id: 'evt_4' } })).processedAt).toBeNull();
      expect((await deliver('connect', accountUpdated('evt_4', account))).status).toBe(200);
      expect((await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } })).chargesEnabled).toBe(true);
    });

    it('acknowledges events for unknown accounts without changing anything', async () => {
      await merchantFor('user_a');
      expect((await deliver('connect', accountUpdated('evt_5', 'acct_unknown'))).status).toBe(200);
      expect(t.stripe.retrieveCalls).toEqual([]);
    });

    it('records but ignores event types it does not handle yet', async () => {
      const res = await deliver('platform', { id: 'evt_6', object: 'event', type: 'balance.available', data: { object: {} } });
      expect(res.status).toBe(200);
      expect((await prisma.stripeEvent.findUniqueOrThrow({ where: { id: 'evt_6' } })).processedAt).not.toBeNull();
    });
  });
});
