import { Inject, Injectable, Logger } from '@nestjs/common';
import { normalizeEmail } from '../../common/email.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { Role } from '../../generated/prisma/enums.js';
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
    const user = await this.findUser(email);
    const merchant = await this.prisma.merchant.findUnique({ where: { ownerUserId: user.id }, select: { id: true } });
    if (merchant) throw new Error(`${email} owns a merchant profile; admins need a separate account`);
    return this.setRole(user, 'ADMIN', 'ADMIN_GRANT');
  }

  async revoke(rawEmail: string): Promise<{ clerkSynced: boolean }> {
    const user = await this.findUser(normalizeEmail(rawEmail));
    return this.setRole(user, 'MERCHANT', 'ADMIN_REVOKE');
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
