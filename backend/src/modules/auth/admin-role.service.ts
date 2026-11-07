import { Inject, Injectable, Logger } from '@nestjs/common';
import { normalizeEmail } from '../../common/email.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { Role } from '../../generated/prisma/enums.js';
import { isUniqueViolation } from '../../prisma/errors.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ClerkAdminApi } from './clerk.js';

// Backs the admin:grant / admin:revoke CLI; there is no HTTP endpoint that changes roles (DESIGN §9).
// Order: allowlist → DB role + AuditLog in one transaction → Clerk publicMetadata (UX mirror).
@Injectable()
export class AdminRoleService {
  private readonly logger = new Logger(AdminRoleService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly clerk: ClerkAdminApi,
  ) {}

  async grant(rawEmail: string): Promise<{ clerkSynced: boolean }> {
    const email = normalizeEmail(rawEmail);
    if (!this.env.ADMIN_EMAIL_ALLOWLIST.includes(email)) {
      throw new Error(`${email} is not in ADMIN_EMAIL_ALLOWLIST`);
    }
    const user = (await this.prisma.user.findFirst({ where: { email, deletedAt: null } })) ?? (await this.createFromClerk(email));
    const merchant = await this.prisma.merchant.findUnique({ where: { ownerUserId: user.id }, select: { id: true } });
    if (merchant) throw new Error(`${email} owns a merchant profile; admins need a separate account`);
    return this.setRole(user, 'ADMIN', 'ADMIN_GRANT');
  }

  async revoke(rawEmail: string): Promise<{ clerkSynced: boolean }> {
    const user = await this.findUser(normalizeEmail(rawEmail));
    return this.setRole(user, 'MERCHANT', 'ADMIN_REVOKE');
  }

  /**
   * A new admin's row, from their Clerk account. The admin host answers 404 to anyone not yet an admin, so they cannot
   * create it by signing in (the API's just-in-time create never runs). Created as MERCHANT; the grant then audits it.
   */
  private async createFromClerk(email: string) {
    const clerkUserId = await this.clerk.findUserIdByEmail(email);
    if (!clerkUserId) throw new Error(`${email} has no Clerk account with it as the verified primary email; they must sign up first`);
    try {
      return await this.prisma.user.create({ data: { clerkUserId, email, role: 'MERCHANT' } });
    } catch (e) {
      // They signed in meanwhile and the API created the row first: take it only if it is that same live address.
      const existing = isUniqueViolation(e) ? await this.prisma.user.findUnique({ where: { clerkUserId } }) : null;
      if (existing && !existing.deletedAt && existing.email === email) return existing;
      throw e;
    }
  }

  private async findUser(email: string) {
    const user = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    if (!user) throw new Error(`${email} must sign in once before their role can change`);
    return user;
  }

  // The DB role and its audit entry commit together; the Clerk mirror runs afterwards. When Clerk is
  // unreachable the failure is audited too and re-running the command retries only the mirror.
  private async setRole(
    user: { id: string; clerkUserId: string; email: string; role: Role },
    role: Role,
    action: 'ADMIN_GRANT' | 'ADMIN_REVOKE',
  ): Promise<{ clerkSynced: boolean }> {
    if (user.role !== role) {
      await this.prisma.$transaction([
        this.prisma.user.update({ where: { id: user.id }, data: { role } }),
        this.prisma.auditLog.create({
          data: { actorRole: 'SYSTEM', action, targetType: 'user', targetId: user.id, metadata: { email: user.email } },
        }),
      ]);
    }
    try {
      await this.clerk.setRole(user.clerkUserId, role);
      return { clerkSynced: true };
    } catch (e) {
      this.logger.warn(`Role saved, but Clerk publicMetadata was not updated for ${user.email}: ${String(e)}`);
      await this.prisma.auditLog.create({
        data: {
          actorRole: 'SYSTEM',
          action: 'ADMIN_ROLE_CLERK_SYNC_FAILED',
          targetType: 'user',
          targetId: user.id,
          metadata: { email: user.email, role, error: String(e) },
        },
      });
      return { clerkSynced: false };
    }
  }
}
