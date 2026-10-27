import { Inject, Injectable, Logger } from '@nestjs/common';
import { normalizeEmail } from '../../common/email.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ClerkAdminApi } from './clerk.js';

// Backs the admin:grant / admin:revoke CLI; there is no HTTP endpoint that changes roles (DESIGN §9).
// Order: allowlist → DB (authoritative) → Clerk publicMetadata (UX mirror) → AuditLog.
@Injectable()
export class AdminRoleService {
  private readonly logger = new Logger(AdminRoleService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly clerk: ClerkAdminApi,
  ) {}

  async grant(rawEmail: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    if (!this.env.ADMIN_EMAIL_ALLOWLIST.includes(email)) {
      throw new Error(`${email} is not in ADMIN_EMAIL_ALLOWLIST`);
    }
    const user = await this.findUser(email);
    const merchant = await this.prisma.merchant.findUnique({ where: { ownerUserId: user.id }, select: { id: true } });
    if (merchant) throw new Error(`${email} owns a merchant profile; admins need a separate account`);
    await this.setRole(user, 'ADMIN', 'ADMIN_GRANT');
  }

  async revoke(rawEmail: string): Promise<void> {
    const user = await this.findUser(normalizeEmail(rawEmail));
    await this.setRole(user, 'MERCHANT', 'ADMIN_REVOKE');
  }

  private async findUser(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) throw new Error(`${email} must sign in once before their role can change`);
    return user;
  }

  private async setRole(
    user: { id: string; clerkUserId: string; email: string },
    role: 'ADMIN' | 'MERCHANT',
    action: 'ADMIN_GRANT' | 'ADMIN_REVOKE',
  ): Promise<void> {
    await this.prisma.user.update({ where: { id: user.id }, data: { role } });
    let clerkSynced = true;
    try {
      await this.clerk.setRole(user.clerkUserId, role);
    } catch (e) {
      clerkSynced = false;
      this.logger.warn(`Role saved, but Clerk publicMetadata was not updated for ${user.email}: ${String(e)}`);
    }
    await this.prisma.auditLog.create({
      data: {
        actorRole: 'SYSTEM',
        action,
        targetType: 'user',
        targetId: user.id,
        metadata: { email: user.email, clerkSynced },
      },
    });
  }
}
