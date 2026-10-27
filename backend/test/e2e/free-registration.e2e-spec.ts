import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { FormField } from '../../src/modules/listings/form-fields.js';
import { registerFree } from '../../src/modules/orders/reservation.js';
import { createTestApp, type TestApp } from './support/app.js';
import { resetDb, testPrisma } from './support/db.js';
import { createMerchant } from './support/factories.js';
import { TURNSTILE_PASS } from './support/turnstile-fake.js';

const ORIGIN = 'http://localhost:3800';
const DAY = 86_400_000;
const future = (days: number) => new Date(Date.now() + days * DAY);

describe('free registration (DESIGN §6, §7.6, §9, M5b)', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  const http = () => request(t.app.getHttpServer());
  const as = (clerkUserId: string) => ({ authorization: `Bearer valid:${clerkUserId}` });

  interface Setup {
    capacity?: number | null;
    onePerEmail?: boolean;
    allowSelfCancel?: boolean;
    selfCancelUntil?: Date | null;
    startsAt?: Date;
    formFields?: FormField[];
    maxQtyPerOrder?: number;
  }

  /** A published free event by merchant `user_m` (no Stripe account at all). */
  async function freeListing(s: Setup = {}) {
    const merchant = await prisma.merchant.findFirstOrThrow({ where: { owner: { clerkUserId: 'user_m' } } });
    return prisma.listing.create({
      data: {
        merchantId: merchant.id,
        shortCode: randomUUID().slice(0, 8),
        title: 'Community talk',
        description: '',
        type: 'EVENT',
        fulfilment: 'ONSITE',
        pricing: 'FREE',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        closesAt: future(2),
        maxQtyPerOrder: s.maxQtyPerOrder ?? 1,
        onePerEmail: s.onePerEmail ?? true,
        allowSelfCancel: s.allowSelfCancel ?? true,
        selfCancelUntil: s.selfCancelUntil === undefined ? future(1) : s.selfCancelUntil,
        policyText: 'Cancel any time before',
        formFields: (s.formFields ?? []) as object[],
        options: {
          create: [{ name: 'Seat', priceCents: 0, capacity: s.capacity === undefined ? 5 : s.capacity, startsAt: s.startsAt ?? future(3) }],
        },
      },
      include: { options: true },
    });
  }
  type Listing = Awaited<ReturnType<typeof freeListing>>;

  const register = (l: Listing, over: Record<string, unknown> = {}, key = randomUUID()) =>
    http()
      .post(`/api/v1/public/listings/${l.shortCode}/orders`)
      .set('Origin', ORIGIN)
      .set('Idempotency-Key', key)
      .send({
        items: [{ optionId: l.options[0].id, quantity: 1 }],
        buyer: { name: 'Amy Lee', email: 'amy@example.test', phone: '021 555 0101' },
        anonymous: false,
        turnstileToken: TURNSTILE_PASS,
        ...over,
      });
  const buyer = (n: number) => ({ name: `Buyer ${n}`, email: `b${n}@example.test`, phone: '021 555 0101' });

  const sold = async (l: Listing) => {
    const [option, listing] = await Promise.all([
      prisma.listingOption.findUniqueOrThrow({ where: { id: l.options[0].id } }),
      prisma.listing.findUniqueOrThrow({ where: { id: l.id } }),
    ]);
    return { option: option.soldCount, reserved: option.reservedCount + listing.reservedCount, listing: listing.soldCount };
  };
  const byCode = (publicCode: string) => prisma.order.findUniqueOrThrow({ where: { publicCode } });
  const cancelOwn = (publicCode: string, token: string) =>
    http().post(`/api/v1/public/orders/${publicCode}/cancel`).set('Origin', ORIGIN).set('X-Order-Token', token);

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
    t.turnstile.reset();
    await createMerchant(prisma, { clerkUserId: 'user_m' });
    await createMerchant(prisma, { clerkUserId: 'user_other' });
  });

  it('a merchant without Stripe publishes a free event; buyers register, cancel, register again and are checked in', async () => {
    const base = '/api/v1/merchants/me/listings';
    const created = await http().post(base).set(as('user_m')).send({ pricing: 'FREE', type: 'EVENT', fulfilment: 'ONSITE', title: 'Saturday yoga' });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const rev = async () => (await prisma.listing.findUniqueOrThrow({ where: { id } })).revision;
    expect((await http().patch(`${base}/${id}`).set(as('user_m')).send({ revision: await rev(), policyText: 'Cancel online', closesAt: future(7).toISOString() })).status).toBe(200);
    const opts = { options: [{ name: 'Sat 9am', priceCents: 0, capacity: 3, active: true, startsAt: future(8).toISOString() }] };
    expect((await http().put(`${base}/${id}/options`).set(as('user_m')).send({ revision: await rev(), ...opts })).status).toBe(200);
    expect((await http().post(`${base}/${id}/publish`).set(as('user_m'))).status).toBe(201);
    const l = await prisma.listing.findUniqueOrThrow({ where: { id }, include: { options: true } });

    const first = await register(l);
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ kind: 'confirmed', publicCode: expect.stringMatching(/^TA-/), accessToken: expect.any(String) });
    expect(await byCode(first.body.publicCode)).toMatchObject({ status: 'CONFIRMED', sequenceNo: 1, isFree: true, totalCents: 0 });
    expect(t.stripe.sessions).toEqual([]);

    const page = await http().get(`/api/v1/public/orders/${first.body.publicCode}`).set('X-Order-Token', first.body.accessToken);
    expect(page.body).toMatchObject({ status: 'CONFIRMED', canCancel: true, sequenceNo: 1 });
    // DESIGN §5.1 default: self-cancel ends 2 hours before the earliest start.
    expect(new Date(page.body.selfCancelUntil).getTime()).toBe(new Date(opts.options[0].startsAt).getTime() - 2 * 3_600_000);

    expect((await cancelOwn(first.body.publicCode, first.body.accessToken)).body).toMatchObject({ status: 'CANCELLED', canCancel: false });
    expect(await sold(l)).toMatchObject({ option: 0, listing: 0 });

    const again = await register(l);
    expect(again.status).toBe(201);
    expect(await byCode(again.body.publicCode)).toMatchObject({ status: 'CONFIRMED', sequenceNo: 2 }); // numbers are never reused

    const list = await http().get(`${base}/${id}/orders`).set(as('user_m'));
    expect(list.body.orders.map((o: { sequenceNo: number; status: string }) => [o.sequenceNo, o.status])).toEqual([
      [2, 'CONFIRMED'],
      [1, 'CANCELLED'],
    ]);
    const orderId = list.body.orders[0].id;
    const checkedIn = await http().post(`/api/v1/merchants/me/orders/${orderId}/fulfil`).set(as('user_m'));
    expect(checkedIn.body).toMatchObject({ status: 'FULFILLED', fulfilledAt: expect.any(String) });
  });

  it('capacity 5, 50 parallel registrations: exactly 5 CONFIRMED', async () => {
    const l = await freeListing({ capacity: 5 });
    const results = await Promise.all(Array.from({ length: 50 }, (_, n) => register(l, { buyer: buyer(n) })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status !== 201).every((r) => r.status === 409 && r.body.code === 'SOLD_OUT')).toBe(true);
    expect(await prisma.order.count({ where: { status: 'CONFIRMED' } })).toBe(5);
    expect(await sold(l)).toEqual({ option: 5, reserved: 0, listing: 5 });
    const seqs = (await prisma.order.findMany({ select: { sequenceNo: true } })).map((o) => o.sequenceNo).sort();
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
  });

  it('one registration per email (any case): a second is refused, the first confirmation is re-sent once an hour', async () => {
    const l = await freeListing();
    const first = await register(l);
    const second = await register(l, { buyer: { name: 'Someone', email: 'AMY@Example.test', phone: '021 000 0000' } });
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ code: 'ALREADY_REGISTERED', message: expect.any(String) }); // nothing about the registration
    await register(l, { buyer: { name: 'Again', email: 'amy@example.test', phone: '021 000 0000' } });
    expect(await prisma.order.count()).toBe(1);
    const mail = await prisma.notificationOutbox.findMany({ where: { type: 'REGISTRATION_CONFIRMED' }, orderBy: { createdAt: 'asc' } });
    const firstId = (await byCode(first.body.publicCode)).id;
    expect(mail.map((m) => m.dedupeKey)).toEqual([`REGISTRATION_CONFIRMED:${firstId}`, expect.stringMatching(`REGISTRATION_CONFIRMED:${firstId}:resend:`)]);
  });

  it('allows the same email twice when the merchant switched onePerEmail off, and keeps the race safe when on', async () => {
    const open = await freeListing({ onePerEmail: false });
    expect((await register(open)).status).toBe(201);
    expect((await register(open)).status).toBe(201);
    const strict = await freeListing({ capacity: 10 });
    const racing = await Promise.all(Array.from({ length: 8 }, () => register(strict)));
    expect(racing.filter((r) => r.status === 201)).toHaveLength(1);
    expect(racing.filter((r) => r.status !== 201).every((r) => r.body.code === 'ALREADY_REGISTERED')).toBe(true);
  });

  it('the same Idempotency-Key answers with the same registration, without asking Turnstile again', async () => {
    const l = await freeListing();
    const key = randomUUID();
    const first = await register(l, {}, key);
    const again = await register(l, { turnstileToken: 'already-used' }, key);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(t.turnstile.calls).toHaveLength(1);
  });

  it('refuses a failed Turnstile check before touching anything', async () => {
    const l = await freeListing();
    const res = await register(l, { turnstileToken: 'bot' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TURNSTILE_FAILED');
    expect(await prisma.order.count()).toBe(0);
    expect(t.turnstile.calls[0].remoteIp).toEqual(expect.any(String));
  });

  it('checks custom answers (required, options, one per place) and keeps them private', async () => {
    const formFields: FormField[] = [
      { key: 'diet', label: 'Diet', type: 'select', required: true, scope: 'order', options: ['Vegan', 'Any'] },
      { key: 'age', label: 'Age', type: 'number', required: true, scope: 'attendee' },
    ];
    const l = await freeListing({ formFields, maxQtyPerOrder: 2, onePerEmail: false });
    const items = (answers: object[]) => [{ optionId: l.options[0].id, quantity: 2, attendeeAnswers: answers }];
    const bad = await register(l, { formAnswers: { diet: 'Meat' }, items: items([{ age: 7 }]) });
    expect(bad.status).toBe(400);
    expect(bad.body.details).toEqual(expect.arrayContaining(['formAnswers.diet: not an option', 'items[0].attendeeAnswers: 2 places need 2 answers']));

    const ok = await register(l, { formAnswers: { diet: 'Vegan' }, items: items([{ age: 7 }, { age: 9 }]) });
    expect(ok.status).toBe(201);
    const stored = await prisma.order.findUniqueOrThrow({ where: { publicCode: ok.body.publicCode }, include: { items: true } });
    expect(stored.formAnswers).toEqual({ diet: 'Vegan' });
    expect(stored.items[0].attendeeAnswers).toEqual([{ age: 7 }, { age: 9 }]);
    const sheet = JSON.stringify((await http().get(`/api/v1/public/listings/${l.shortCode}/participants`)).body);
    expect(sheet).not.toContain('Vegan');
  });

  it('self-cancel only while the listing allows it and before its deadline; it frees the place', async () => {
    const l = await freeListing({ capacity: 1, onePerEmail: false });
    const r = await register(l);
    expect((await register(l, { buyer: buyer(2) })).body.code).toBe('SOLD_OUT');
    expect((await cancelOwn(r.body.publicCode, r.body.accessToken)).status).toBe(200);
    expect(await sold(l)).toMatchObject({ option: 0, listing: 0 });
    expect((await register(l, { buyer: buyer(2) })).status).toBe(201);

    const late = await freeListing({ selfCancelUntil: new Date(Date.now() - 1000) });
    const r2 = await register(late);
    expect((await http().get(`/api/v1/public/orders/${r2.body.publicCode}`).set('X-Order-Token', r2.body.accessToken)).body.canCancel).toBe(false);
    expect((await cancelOwn(r2.body.publicCode, r2.body.accessToken)).body.code).toBe('SELF_CANCEL_WINDOW_PASSED');

    const never = await freeListing({ allowSelfCancel: false });
    const r3 = await register(never);
    expect((await cancelOwn(r3.body.publicCode, r3.body.accessToken)).body.code).toBe('SELF_CANCEL_WINDOW_PASSED');
    expect((await byCode(r3.body.publicCode)).status).toBe('CONFIRMED');
  });

  it('an option switched off after the request was checked cannot be taken (the check repeats under the lock)', async () => {
    const l = await freeListing();
    await prisma.listingOption.create({ data: { listingId: l.id, name: 'Standing', priceCents: 0, capacity: 5 } });
    await prisma.listingOption.update({ where: { id: l.options[0].id }, data: { active: false } });
    // The listing still takes orders (another option is on), as registerFree sees it under the lock.
    const attempt = prisma.$transaction((tx) => registerFree(tx, l.id, [{ optionId: l.options[0].id, quantity: 1 }]));
    await expect(attempt).rejects.toMatchObject({ code: 'SOLD_OUT' });
    expect(await sold(l)).toEqual({ option: 0, reserved: 0, listing: 0 });
  });

  describe('merchant actions', () => {
    const merchantPost = (who: string, orderId: string, action: string, body: object = {}) =>
      http().post(`/api/v1/merchants/me/orders/${orderId}/${action}`).set(as(who)).send(body);

    it('cancels a registration with a reason: place freed, buyer emailed; another merchant gets 404', async () => {
      const l = await freeListing();
      const { id } = await byCode((await register(l)).body.publicCode);
      expect((await merchantPost('user_other', id, 'cancel', { reason: 'x' })).status).toBe(404);
      const res = await merchantPost('user_m', id, 'cancel', { reason: 'Venue flooded' });
      expect(res.body).toMatchObject({ status: 'CANCELLED', cancelledAt: expect.any(String) });
      expect(await sold(l)).toMatchObject({ option: 0, listing: 0 });
      expect(await prisma.notificationOutbox.findFirstOrThrow({ where: { type: 'REGISTRATION_CANCELLED' } })).toMatchObject({
        recipient: 'amy@example.test',
        payload: expect.objectContaining({ reason: 'Venue flooded' }),
      });
    });

    it('marks a no-show only once the event has started, and keeps the place counted', async () => {
      const soon = await freeListing();
      const { id } = await byCode((await register(soon)).body.publicCode);
      const flags = async (listingId: string) =>
        (await http().get(`/api/v1/merchants/me/listings/${listingId}/orders`).set(as('user_m'))).body.orders[0];
      expect(await flags(soon.id)).toMatchObject({ canFulfil: true, canCancel: true, canNoShow: false });
      expect((await merchantPost('user_m', id, 'no-show')).body.code).toBe('INVALID_STATE_TRANSITION');
      const started = await freeListing({ startsAt: new Date(Date.now() - 3_600_000) });
      await prisma.listing.update({ where: { id: started.id }, data: { selfCancelUntil: null } });
      const { id: id2 } = await byCode((await register(started, { buyer: buyer(2) })).body.publicCode);
      expect(await flags(started.id)).toMatchObject({ canNoShow: true });
      expect((await merchantPost('user_m', id2, 'no-show')).body).toMatchObject({ status: 'NO_SHOW', canFulfil: false, canCancel: false, canNoShow: false });
      expect(await sold(started)).toMatchObject({ option: 1 });
    });

    it("lists only its own listing's registrations, searchable, and never another merchant's", async () => {
      const l = await freeListing({ onePerEmail: false });
      await register(l);
      await register(l, { buyer: { name: 'Bob Chen', email: 'bob@example.test', phone: '021 555 0202' } });
      const list = await http().get(`/api/v1/merchants/me/listings/${l.id}/orders`).query({ q: 'chen' }).set(as('user_m'));
      expect(list.body.orders.map((o: { buyerName: string }) => o.buyerName)).toEqual(['Bob Chen']);
      expect((await http().get(`/api/v1/merchants/me/listings/${l.id}/orders`).set(as('user_other'))).status).toBe(404);
    });
  });
});
