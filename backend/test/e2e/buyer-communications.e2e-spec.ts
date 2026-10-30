import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { OutboxJob } from '../../src/modules/notifications/outbox.job.js';
import { RecoveryJob } from '../../src/modules/orders/recovery.job.js';
import { ReminderJob } from '../../src/modules/orders/reminder.job.js';
import { createTestApp, type TestApp } from './support/app.js';
import { resetDb, testPrisma } from './support/db.js';
import { createMerchant } from './support/factories.js';
import { TURNSTILE_PASS } from './support/turnstile-fake.js';

const ORIGIN = 'http://localhost:3800';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('buyer communications: emails, .ics, reminders, find my orders, merchant page (DESIGN §9, §11, §12, M7)', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  let merchantId: string;
  let slug: string;
  const http = () => request(t.app.getHttpServer());

  /** A published free listing of `user_m`, with one option starting `startsIn` ms from now (or none for RETAIL). */
  async function listing(over: { type?: 'EVENT' | 'RETAIL'; startsIn?: number; remindBeforeHours?: number | null; status?: 'PUBLISHED' | 'DRAFT' | 'CLOSED' | 'CANCELLED'; title?: string } = {}) {
    const type = over.type ?? 'EVENT';
    return prisma.listing.create({
      data: {
        merchantId,
        shortCode: randomUUID().slice(0, 8),
        title: over.title ?? 'Saturday yoga',
        description: '',
        type,
        fulfilment: 'ONSITE', // no pickup point to choose: retail handed over at the stall
        pricing: 'FREE',
        status: over.status ?? 'PUBLISHED',
        publishedAt: new Date(),
        closesAt: new Date(Date.now() + 10 * DAY),
        maxQtyPerOrder: 1,
        onePerEmail: false,
        allowSelfCancel: true,
        remindBeforeHours: over.remindBeforeHours === undefined ? 24 : over.remindBeforeHours,
        policyText: 'x',
        options: {
          create: [
            {
              name: 'Seat',
              priceCents: 0,
              capacity: 10,
              location: type === 'RETAIL' ? null : 'Albany Hall, 1 Main St',
              startsAt: type === 'RETAIL' ? null : new Date(Date.now() + (over.startsIn ?? 3 * DAY)),
            },
          ],
        },
      },
      include: { options: true },
    });
  }
  type Listing = Awaited<ReturnType<typeof listing>>;

  const register = (l: Listing, email = 'amy@example.test', locale = 'en') =>
    http()
      .post(`/api/v1/public/listings/${l.shortCode}/orders`)
      .set('Origin', ORIGIN)
      .set('Idempotency-Key', randomUUID())
      .send({
        items: [{ optionId: l.options[0].id, quantity: 1 }],
        buyer: { name: 'Amy Lee', email, phone: '021 555 0101' },
        anonymous: false,
        turnstileToken: TURNSTILE_PASS,
        locale,
      });
  const recover = (email: string, turnstileToken = TURNSTILE_PASS) =>
    http().post('/api/v1/public/orders/recover').set('Origin', ORIGIN).send({ email, turnstileToken, locale: 'en' });
  const outbox = (type: string) => prisma.notificationOutbox.findMany({ where: { type }, orderBy: { createdAt: 'asc' } });

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
    t.email.reset();
    const m = await createMerchant(prisma, { clerkUserId: 'user_m' });
    const updated = await prisma.merchant.update({
      where: { id: m.id },
      data: { displayName: 'Kiwi Yoga', gstNumber: '123-456-789', description: 'Classes in **Albany**', contactEmail: 'owner@kiwi.test', contactPhone: '021999888' },
    });
    merchantId = updated.id;
    slug = updated.slug;
  });

  describe('confirmation email', () => {
    it('carries the seller and GST number, the find-my-orders footer and the .ics of the session (in UTC)', async () => {
      const l = await listing();
      expect((await register(l)).status).toBe(201);
      await t.app.get(OutboxJob).run();
      expect(t.email.sent).toHaveLength(1);
      const [mail] = t.email.sent;
      expect(mail.text).toContain('Sold by Kiwi Yoga · GST 123-456-789');
      expect(mail.text).toContain('Find all your orders: http://localhost:3800/en/find-order');
      const start = l.options[0].startsAt!.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      expect(mail.attachments).toEqual([
        expect.objectContaining({ contentType: 'text/calendar; charset=utf-8', content: expect.stringContaining(`DTSTART:${start}`) }),
      ]);
      expect(mail.attachments![0].content).toContain('LOCATION:Albany Hall\\, 1 Main St');
    });

    it('has no calendar file for a retail order', async () => {
      const l = await listing({ type: 'RETAIL' });
      await register(l);
      await t.app.get(OutboxJob).run();
      expect(t.email.sent[0].attachments).toBeUndefined();
    });
  });

  describe('outbox leases', () => {
    it('a worker whose lease ran out cannot overwrite the send of the worker that took over', async () => {
      await prisma.notificationOutbox.create({
        data: { type: 'PICKUP_POINT_CHANGED', recipient: 'amy@example.test', locale: 'en', payload: { label: 'Hall', address: '1 Main St' }, dedupeKey: 'lease-test' },
      });
      const job = t.app.get(OutboxJob);
      // The first worker's send hangs past its lease, then fails.
      let fail!: (e: Error) => void;
      const send = vi.spyOn(t.email, 'send').mockImplementationOnce(() => new Promise<void>((_, reject) => (fail = reject)));
      const now = new Date();
      const stalled = job.run(now);
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(await job.run(new Date(now.getTime() + 6 * 60_000))).toEqual({ sent: 1, retrying: 0, failed: 0 });
      fail(new Error('provider timeout'));
      await stalled;
      send.mockRestore();
      expect(await prisma.notificationOutbox.findUniqueOrThrow({ where: { dedupeKey: 'lease-test' } })).toMatchObject({
        status: 'SENT',
        attempts: 0,
        lastError: null,
      });
      expect(t.email.sent.map((m) => m.to)).toEqual(['amy@example.test']);
    });
  });

  describe('calendar download', () => {
    const calendar = (code: string, token: string) => http().get(`/api/v1/public/orders/${code}/calendar.ics`).set('X-Order-Token', token);

    it('serves the .ics to the order token only, for event orders only', async () => {
      const l = await listing();
      const { body } = await register(l);
      const order = await http().get(`/api/v1/public/orders/${body.publicCode}`).set('X-Order-Token', body.accessToken);
      expect(order.body.hasCalendar).toBe(true);
      const res = await calendar(body.publicCode, body.accessToken);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/calendar');
      expect(res.text).toMatch(/^BEGIN:VCALENDAR\r\n/);
      expect(res.text).toContain('SUMMARY:Saturday yoga');
      expect((await calendar(body.publicCode, 'wrong')).status).toBe(404);

      // A retail option with a date (say, a pickup day) is still not an event.
      const shop = await listing({ type: 'RETAIL' });
      await prisma.listingOption.update({ where: { id: shop.options[0].id }, data: { startsAt: new Date(Date.now() + DAY) } });
      const retail = await register(shop, 'bob@example.test');
      expect((await http().get(`/api/v1/public/orders/${retail.body.publicCode}`).set('X-Order-Token', retail.body.accessToken)).body.hasCalendar).toBe(false);
      expect((await calendar(retail.body.publicCode, retail.body.accessToken)).status).toBe(404);
    });

    it('is gone once the registration is cancelled', async () => {
      const { body } = await register(await listing());
      await http().post(`/api/v1/public/orders/${body.publicCode}/cancel`).set('Origin', ORIGIN).set('X-Order-Token', body.accessToken);
      expect((await calendar(body.publicCode, body.accessToken)).status).toBe(404);
    });
  });

  describe('event reminders', () => {
    const remind = (at = new Date(), batch?: number) => t.app.get(ReminderJob).remindDue(at, batch);

    it('reminds once, inside the window before the first session', async () => {
      const soon = await listing({ startsIn: 20 * HOUR });
      const { body } = await register(soon);
      expect(await remind()).toBe(1);
      expect(await remind()).toBe(0);
      const [row] = await outbox('EVENT_REMINDER');
      expect(row).toMatchObject({ recipient: 'amy@example.test', locale: 'en' });
      expect(row.payload).toMatchObject({ publicCode: body.publicCode, listingTitle: 'Saturday yoga', events: [expect.objectContaining({ location: 'Albany Hall, 1 Main St' })] });
      expect((await prisma.order.findUniqueOrThrow({ where: { publicCode: body.publicCode } })).reminderSentAt).not.toBeNull();
      await t.app.get(OutboxJob).run();
      expect(t.email.sent.find((m) => m.subject.startsWith('Reminder: Saturday yoga'))?.attachments).toHaveLength(1);
    });

    it('drains every due order in one run, one batch at a time, soonest session first', async () => {
      await register(await listing({ startsIn: 20 * HOUR }), 'late@example.test');
      await register(await listing({ startsIn: 5 * HOUR }), 'first@example.test');
      await register(await listing({ startsIn: 10 * HOUR }), 'middle@example.test');
      expect(await remind(new Date(), 1)).toBe(3);
      expect((await outbox('EVENT_REMINDER')).map((r) => r.recipient)).toEqual(['first@example.test', 'middle@example.test', 'late@example.test']);
    });

    it('waits until the window opens, uses the listing setting, and skips retail, cancelled and past orders', async () => {
      await register(await listing({ startsIn: 30 * HOUR }), 'later@example.test'); // 24 h window not open yet
      await register(await listing({ startsIn: 30 * HOUR, remindBeforeHours: 48 }), 'early@example.test');
      await register(await listing({ type: 'RETAIL' }), 'retail@example.test');
      const cancelled = await register(await listing({ startsIn: 2 * HOUR }), 'gone@example.test');
      await http().post(`/api/v1/public/orders/${cancelled.body.publicCode}/cancel`).set('Origin', ORIGIN).set('X-Order-Token', cancelled.body.accessToken);
      const past = await listing({ startsIn: 2 * HOUR });
      await register(past, 'past@example.test');
      expect(await remind(new Date(Date.now() + 3 * HOUR))).toBe(1); // past's session started; only "early" is due
      expect((await outbox('EVENT_REMINDER')).map((r) => r.recipient)).toEqual(['early@example.test']);
      expect(await remind(new Date(Date.now() + 7 * HOUR))).toBe(1);
      expect((await outbox('EVENT_REMINDER')).map((r) => r.recipient).sort()).toEqual(['early@example.test', 'later@example.test']);
    });
  });

  describe('find my orders', () => {
    const handle = () => t.app.get(RecoveryJob).run();

    it('answers the same for an address with orders and one without, doing the same work for both', async () => {
      await register(await listing());
      const known = await recover('amy@example.test');
      const unknown = await recover('nobody@example.test');
      expect(known.status).toBe(202);
      expect({ status: unknown.status, body: unknown.body }).toEqual({ status: known.status, body: known.body });
      // The request only queues itself; nothing about the address is looked up before the answer.
      expect((await prisma.orderRecoveryRequest.findMany({ orderBy: { createdAt: 'asc' } })).map((r) => r.email)).toEqual(['amy@example.test', 'nobody@example.test']);
      expect(await outbox('ORDER_RECOVERY')).toHaveLength(0);
      expect(await handle()).toBe(1);
      expect((await outbox('ORDER_RECOVERY')).map((r) => r.recipient)).toEqual(['amy@example.test']);
      expect(await prisma.orderRecoveryRequest.count()).toBe(0);
    });

    it('lists only valid orders of the last 90 days, whatever the case of the address', async () => {
      const a = await register(await listing({ title: 'Yoga' }), 'Amy@Example.test');
      const old = await register(await listing({ title: 'Old class' }), 'amy@example.test');
      await prisma.order.update({ where: { publicCode: old.body.publicCode }, data: { createdAt: new Date(Date.now() - 100 * DAY) } });
      const gone = await register(await listing({ title: 'Cancelled class' }), 'amy@example.test');
      await http().post(`/api/v1/public/orders/${gone.body.publicCode}/cancel`).set('Origin', ORIGIN).set('X-Order-Token', gone.body.accessToken);
      await recover('AMY@example.TEST');
      await handle();
      const [row] = await outbox('ORDER_RECOVERY');
      expect(row.recipient).toBe('amy@example.test');
      expect((row.payload as { orders: { publicCode: string; url: string }[] }).orders).toEqual([
        expect.objectContaining({ publicCode: a.body.publicCode, url: `http://localhost:3800/en/o/${a.body.publicCode}?t=${a.body.accessToken}` }),
      ]);
    });

    it('sends at most 3 an hour per address, still answering the same', async () => {
      await register(await listing());
      for (let i = 0; i < 4; i++) expect((await recover('amy@example.test')).status).toBe(202);
      expect(await handle()).toBe(3);
      await recover('amy@example.test');
      expect(await handle()).toBe(0); // a later run counts the emails already queued
      expect(await outbox('ORDER_RECOVERY')).toHaveLength(3);
    });

    it('requires the human check', async () => {
      const res = await recover('amy@example.test', 'bot');
      expect(res.body.code).toBe('TURNSTILE_FAILED');
      expect(await prisma.orderRecoveryRequest.count()).toBe(0);
    });
  });

  describe('public merchant page', () => {
    const page = (s = slug) => http().get(`/api/v1/public/merchants/${s}`);

    it('shows published and closed listings, never drafts or cancelled ones, and no contact details', async () => {
      await listing({ title: 'Open class' });
      await listing({ title: 'Closed class', status: 'CLOSED' });
      await listing({ title: 'Draft class', status: 'DRAFT' });
      await listing({ title: 'Cancelled class', status: 'CANCELLED' });
      const res = await page();
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ slug, displayName: 'Kiwi Yoga', description: 'Classes in **Albany**', suspended: false });
      expect(res.body.listings.map((l: { title: string }) => l.title).sort()).toEqual(['Closed class', 'Open class']);
      expect(res.body.listings.find((l: { title: string }) => l.title === 'Open class')).toMatchObject({ availability: 'OPEN', pricing: 'FREE', minPriceCents: 0 });
      const json = JSON.stringify(res.body);
      for (const secret of ['owner@kiwi.test', '021999888', '123-456-789', merchantId]) expect(json).not.toContain(secret);
    });

    it('shows a suspended merchant without listings, and 404 for an unknown one', async () => {
      await listing();
      await prisma.merchant.update({ where: { id: merchantId }, data: { status: 'SUSPENDED' } });
      expect((await page()).body).toMatchObject({ suspended: true, listings: [] });
      expect((await page('no-such-merchant')).status).toBe(404);
    });
  });
});
