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
    await roles.grant('OPS@tagalong.test');
    expect((await prisma.user.findUniqueOrThrow({ where: { clerkUserId: 'user_ops' } })).role).toBe('ADMIN');
    expect(t.clerk.roleCalls).toEqual([{ clerkUserId: 'user_ops', role: 'admin' }]);
    const [audit] = await prisma.auditLog.findMany();
    expect(audit).toMatchObject({ actorRole: 'SYSTEM', actorUserId: null, action: 'ADMIN_GRANT', targetType: 'user' });
    expect(audit.metadata).toMatchObject({ email: 'ops@tagalong.test', clerkSynced: true });
  });

  it('keeps the DB grant and records the failure when Clerk is unreachable', async () => {
    await prisma.user.create({ data: { email: 'ops@tagalong.test', clerkUserId: 'user_ops' } });
    t.clerk.failSetRole = true;
    await roles.grant('ops@tagalong.test');
    expect((await prisma.user.findUniqueOrThrow({ where: { clerkUserId: 'user_ops' } })).role).toBe('ADMIN');
    expect((await prisma.auditLog.findFirstOrThrow()).metadata).toMatchObject({ clerkSynced: false });
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
