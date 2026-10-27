import { Controller, Get, Post } from '@nestjs/common';
import request from 'supertest';
import { Webhook } from 'svix';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { Auth } from '../../src/modules/auth/auth.decorator.js';
import { createTestApp, type TestApp } from './support/app.js';
import { resetDb, testPrisma } from './support/db.js';
import { createMerchant } from './support/factories.js';

@Auth('ADMIN')
@Controller('admin/probe')
class AdminProbeController {
  @Get()
  get() {
    return { ok: true };
  }
}

@Auth('MERCHANT')
@Controller('merchant-probe')
class MerchantProbeController {
  @Post()
  write() {
    return { ok: true };
  }
}

const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SIGNING_SECRET!;

function signed(id: string, payload: object) {
  const body = JSON.stringify(payload);
  const timestamp = new Date();
  const signature = new Webhook(WEBHOOK_SECRET).sign(id, timestamp, body);
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'svix-id': id,
      'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
      'svix-signature': signature,
    },
  };
}

function userEvent(type: 'user.created' | 'user.updated', clerkUserId: string, email: string, updatedAt = Date.now()) {
  return {
    type,
    data: {
      id: clerkUserId,
      updated_at: updatedAt,
      primary_email_address_id: 'idn_1',
      email_addresses: [
        { id: 'idn_0', email_address: 'old@example.test' },
        { id: 'idn_1', email_address: email },
      ],
    },
  };
}

describe('auth', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp([AdminProbeController, MerchantProbeController]);
    prisma = testPrisma();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    t.clerk.users.clear();
    t.clerk.roleCalls.length = 0;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await t.app.close();
  });

  describe('ClerkAuthGuard', () => {
    it('rejects requests without a token', async () => {
      const res = await http().get('/api/v1/me');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a token that fails verification', async () => {
      const res = await http().get('/api/v1/me').set('authorization', 'Bearer forged');
      expect(res.status).toBe(401);
    });

    it('creates the user as MERCHANT on the first request and mirrors the role to Clerk', async () => {
      t.clerk.users.set('user_new', 'New@Example.test');
      const res = await http().get('/api/v1/me').set('cookie', '__session=valid:user_new');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ email: 'new@example.test', role: 'MERCHANT', hasMerchantProfile: false });
      expect(await prisma.user.count()).toBe(1);
      expect(t.clerk.roleCalls).toEqual([{ clerkUserId: 'user_new', role: 'merchant' }]);
    });

    it('creates exactly one user when first requests race', async () => {
      t.clerk.users.set('user_race', 'race@example.test');
      const results = await Promise.all(
        Array.from({ length: 5 }, () => http().get('/api/v1/me').set('authorization', 'Bearer valid:user_race')),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect(await prisma.user.count({ where: { clerkUserId: 'user_race' } })).toBe(1);
    });

    it('prefers the __session cookie over the Authorization header', async () => {
      t.clerk.users.set('user_cookie', 'cookie@example.test');
      const res = await http()
        .get('/api/v1/me')
        .set('cookie', '__session=valid:user_cookie')
        .set('authorization', 'Bearer forged');
      expect(res.status).toBe(200);
      expect(res.body.email).toBe('cookie@example.test');
    });

    it('a new account can sign up with the email of a deleted one', async () => {
      await prisma.user.create({
        data: { email: 'reuse@example.test', clerkUserId: 'user_old', deletedAt: new Date() },
      });
      t.clerk.users.set('user_new2', 'reuse@example.test');
      const res = await http().get('/api/v1/me').set('authorization', 'Bearer valid:user_new2');
      expect(res.status).toBe(200);
      expect(res.body.email).toBe('reuse@example.test');
      expect(await prisma.user.count({ where: { email: 'reuse@example.test' } })).toBe(2);
    });

    it('two live accounts can never share an email', async () => {
      await prisma.user.create({ data: { email: 'taken@example.test', clerkUserId: 'user_x' } });
      await expect(
        prisma.user.create({ data: { email: 'taken@example.test', clerkUserId: 'user_y' } }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('rejects a soft-deleted user', async () => {
      await prisma.user.create({
        data: { email: 'gone@example.test', clerkUserId: 'user_gone', deletedAt: new Date() },
      });
      const res = await http().get('/api/v1/me').set('authorization', 'Bearer valid:user_gone');
      expect(res.status).toBe(401);
    });
  });

  describe('RolesGuard (role read from the DB, never the JWT)', () => {
    it('a merchant token gets 403 on /admin routes', async () => {
      await prisma.user.create({ data: { email: 'm@example.test', clerkUserId: 'user_m' } });
      const res = await http().get('/api/v1/admin/probe').set('authorization', 'Bearer valid:user_m');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('an admin token gets 403 on merchant-only write routes', async () => {
      await prisma.user.create({ data: { email: 'a@example.test', clerkUserId: 'user_a', role: 'ADMIN' } });
      const res = await http().post('/api/v1/merchant-probe').set('authorization', 'Bearer valid:user_a');
      expect(res.status).toBe(403);
    });

    it('a revoked admin is rejected immediately while still holding a valid session', async () => {
      const admin = await prisma.user.create({
        data: { email: 'a@example.test', clerkUserId: 'user_a', role: 'ADMIN' },
      });
      const asAdmin = () => http().get('/api/v1/admin/probe').set('authorization', 'Bearer valid:user_a');
      expect((await asAdmin()).status).toBe(200);
      await prisma.user.update({ where: { id: admin.id }, data: { role: 'MERCHANT' } });
      expect((await asAdmin()).status).toBe(403);
    });
  });

  describe('POST /webhooks/clerk', () => {
    const post = (msg: { body: string; headers: Record<string, string> }) =>
      http().post('/api/v1/webhooks/clerk').set(msg.headers).send(msg.body);

    it('rejects a bad signature and changes nothing', async () => {
      const msg = signed('msg_1', userEvent('user.created', 'user_w', 'w@example.test'));
      const res = await post({ ...msg, headers: { ...msg.headers, 'svix-signature': 'v1,Zm9yZ2Vk' } });
      expect(res.status).toBe(400);
      expect(await prisma.user.count()).toBe(0);
    });

    it('user.created upserts by clerkUserId with the primary email; a replay has one effect', async () => {
      const msg = signed('msg_2', userEvent('user.created', 'user_w', 'W@Example.test'));
      expect((await post(msg)).status).toBe(200);
      expect((await post(msg)).status).toBe(200);
      const users = await prisma.user.findMany();
      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({ clerkUserId: 'user_w', email: 'w@example.test', role: 'MERCHANT' });
      expect(t.clerk.roleCalls).toEqual([{ clerkUserId: 'user_w', role: 'merchant' }]);
    });

    it('user.updated changes the email but never the role', async () => {
      await prisma.user.create({ data: { email: 'a@example.test', clerkUserId: 'user_a', role: 'ADMIN' } });
      await post(signed('msg_3', userEvent('user.updated', 'user_a', 'new-a@example.test')));
      expect(await prisma.user.findUnique({ where: { clerkUserId: 'user_a' } })).toMatchObject({
        email: 'new-a@example.test',
        role: 'ADMIN',
      });
    });

    it('user.deleted soft-deletes the user and suspends their merchant, keeping data', async () => {
      const merchant = await createMerchant(prisma);
      const owner = await prisma.user.findUniqueOrThrow({ where: { id: merchant.ownerUserId } });
      const msg = signed('msg_4', { type: 'user.deleted', data: { id: owner.clerkUserId, deleted: true } });
      expect((await post(msg)).status).toBe(200);
      expect((await post(msg)).status).toBe(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).deletedAt).not.toBeNull();
      expect(await prisma.merchant.findUniqueOrThrow({ where: { id: merchant.id } })).toMatchObject({
        status: 'SUSPENDED',
        suspendedReason: 'Account deleted',
      });
    });

    it('a deletion that arrives before the creation is not undone by the late user.created', async () => {
      expect((await post(signed('msg_d1', { type: 'user.deleted', data: { id: 'user_late', deleted: true } }))).status).toBe(200);
      await post(signed('msg_d2', userEvent('user.created', 'user_late', 'late@example.test')));
      const user = await prisma.user.findUniqueOrThrow({ where: { clerkUserId: 'user_late' } });
      expect(user.deletedAt).not.toBeNull();
      expect(t.clerk.roleCalls).toEqual([]);
      expect((await http().get('/api/v1/me').set('authorization', 'Bearer valid:user_late')).status).toBe(401);
    });

    it('an older user event never overwrites a newer email', async () => {
      await post(signed('msg_o1', userEvent('user.updated', 'user_o', 'new@example.test', 2_000)));
      await post(signed('msg_o2', userEvent('user.created', 'user_o', 'old@example.test', 1_000)));
      await post(signed('msg_o3', userEvent('user.updated', 'user_o', 'older@example.test', 1_500)));
      expect((await prisma.user.findUniqueOrThrow({ where: { clerkUserId: 'user_o' } })).email).toBe('new@example.test');
    });

    it('session.created by an admin writes one audit entry and one alert per admin, even when replayed', async () => {
      await prisma.user.create({ data: { email: 'a1@example.test', clerkUserId: 'user_a1', role: 'ADMIN' } });
      await prisma.user.create({ data: { email: 'a2@example.test', clerkUserId: 'user_a2', role: 'ADMIN' } });
      await prisma.user.create({ data: { email: 'm@example.test', clerkUserId: 'user_m' } });
      const msg = signed('msg_5', { type: 'session.created', data: { id: 'sess_1', user_id: 'user_a1' } });
      await post(msg);
      await post(msg);
      const audits = await prisma.auditLog.findMany();
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ action: 'ADMIN_SIGN_IN', targetType: 'session', targetId: 'sess_1' });
      const alerts = await prisma.notificationOutbox.findMany({ orderBy: { recipient: 'asc' } });
      expect(alerts.map((a) => [a.type, a.recipient])).toEqual([
        ['ADMIN_SIGN_IN', 'a1@example.test'],
        ['ADMIN_SIGN_IN', 'a2@example.test'],
      ]);
    });

    it('session.created by a merchant records nothing', async () => {
      await prisma.user.create({ data: { email: 'm@example.test', clerkUserId: 'user_m' } });
      await post(signed('msg_6', { type: 'session.created', data: { id: 'sess_2', user_id: 'user_m' } }));
      expect(await prisma.auditLog.count()).toBe(0);
      expect(await prisma.notificationOutbox.count()).toBe(0);
    });
  });
});
