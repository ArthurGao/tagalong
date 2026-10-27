import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { AdminRoleService } from '../../src/modules/auth/admin-role.service.js';
import { createTestApp, type TestApp } from './support/app.js';
import { resetDb, testPrisma } from './support/db.js';
import { createMerchant } from './support/factories.js';

// ADMIN_EMAIL_ALLOWLIST=ops@tagalong.test in vitest.config.ts
describe('admin:grant / admin:revoke', () => {
  let t: TestApp;
  let prisma: PrismaClient;
  let roles: AdminRoleService;

  beforeAll(async () => {
    t = await createTestApp();
    prisma = testPrisma();
    roles = t.app.get(AdminRoleService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
    t.clerk.roleCalls.length = 0;
    t.clerk.failSetRole = false;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await t.app.close();
  });

  it('refuses an email outside the allowlist before touching anything', async () => {
    await prisma.user.create({ data: { email: 'intruder@tagalong.test', clerkUserId: 'user_i' } });
    await expect(roles.grant('intruder@tagalong.test')).rejects.toThrow(/ADMIN_EMAIL_ALLOWLIST/);
    expect((await prisma.user.findUniqueOrThrow({ where: { clerkUserId: 'user_i' } })).role).toBe('MERCHANT');
    expect(t.clerk.roleCalls).toEqual([]);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('grants ADMIN in the DB, mirrors it to Clerk and audits it as SYSTEM', async () => {
    await prisma.user.create({ data: { email: 'ops@tagalong.test', clerkUserId: 'user_ops' } });
    expect(await roles.grant('OPS@tagalong.test')).toEqual({ clerkSynced: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { clerkUserId: 'user_ops' } })).role).toBe('ADMIN');
    expect(t.clerk.roleCalls).toEqual([{ clerkUserId: 'user_ops', role: 'admin' }]);
    const audits = await prisma.auditLog.findMany();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorRole: 'SYSTEM', actorUserId: null, action: 'ADMIN_GRANT', targetType: 'user' });
    expect(audits[0].metadata).toMatchObject({ email: 'ops@tagalong.test' });
  });

  it('commits the grant with its audit entry even when Clerk is unreachable, and records the failed sync', async () => {
    await prisma.user.create({ data: { email: 'ops@tagalong.test', clerkUserId: 'user_ops' } });
    t.clerk.failSetRole = true;
    expect(await roles.grant('ops@tagalong.test')).toEqual({ clerkSynced: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { clerkUserId: 'user_ops' } })).role).toBe('ADMIN');
    const actions = (await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(['ADMIN_GRANT', 'ADMIN_ROLE_CLERK_SYNC_FAILED']);
  });

  it('re-running a grant for an existing admin only retries the Clerk sync', async () => {
    await prisma.user.create({ data: { email: 'ops@tagalong.test', clerkUserId: 'user_ops', role: 'ADMIN' } });
    expect(await roles.grant('ops@tagalong.test')).toEqual({ clerkSynced: true });
    expect(t.clerk.roleCalls).toEqual([{ clerkUserId: 'user_ops', role: 'admin' }]);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('refuses a user who has never signed in', async () => {
    await expect(roles.grant('ops@tagalong.test')).rejects.toThrow(/sign in once/);
  });

  it('refuses a user who owns a merchant profile (one role per account)', async () => {
    const merchant = await createMerchant(prisma);
    await prisma.user.update({ where: { id: merchant.ownerUserId }, data: { email: 'ops@tagalong.test' } });
    await expect(roles.grant('ops@tagalong.test')).rejects.toThrow(/merchant profile/);
    expect(t.clerk.roleCalls).toEqual([]);
  });

  it('revoke returns the user to MERCHANT and audits it', async () => {
    await prisma.user.create({ data: { email: 'ops@tagalong.test', clerkUserId: 'user_ops', role: 'ADMIN' } });
    await roles.revoke('ops@tagalong.test');
    expect((await prisma.user.findUniqueOrThrow({ where: { clerkUserId: 'user_ops' } })).role).toBe('MERCHANT');
    expect(t.clerk.roleCalls).toEqual([{ clerkUserId: 'user_ops', role: 'merchant' }]);
    expect((await prisma.auditLog.findFirstOrThrow()).action).toBe('ADMIN_REVOKE');
  });
});
