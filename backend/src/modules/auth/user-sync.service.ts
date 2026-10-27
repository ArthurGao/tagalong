import { Injectable, Logger } from '@nestjs/common';
import { normalizeEmail } from '../../common/email.js';
import { isUniqueViolation } from '../../prisma/errors.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ClerkAdminApi } from './clerk.js';

const withMerchant = { merchant: { select: { id: true } } } as const;

@Injectable()
export class UserSyncService {
  private readonly logger = new Logger(UserSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clerk: ClerkAdminApi,
  ) {}

  /** Guard path, every authenticated request: one indexed read; the first request creates a MERCHANT. */
  async ensureUser(clerkUserId: string) {
    const existing = await this.prisma.user.findUnique({ where: { clerkUserId }, include: withMerchant });
    if (existing) return existing;
    await this.createMerchantUser(clerkUserId, await this.clerk.getPrimaryEmail(clerkUserId));
    return this.prisma.user.findUniqueOrThrow({ where: { clerkUserId }, include: withMerchant });
  }

  /** Webhook path (user.created / user.updated): idempotent; updates the email, never the role. */
  async upsertFromClerk(clerkUserId: string, email: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!existing) return this.createMerchantUser(clerkUserId, email);
    if (existing.email !== normalizeEmail(email)) {
      await this.prisma.user.update({ where: { id: existing.id }, data: { email: normalizeEmail(email) } });
    }
  }

  /** user.deleted: soft-delete and suspend the merchant; orders and money records stay. */
  async softDelete(clerkUserId: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.updateMany({ where: { clerkUserId, deletedAt: null }, data: { deletedAt: now } }),
      this.prisma.merchant.updateMany({
        where: { owner: { clerkUserId }, status: 'ACTIVE' },
        data: { status: 'SUSPENDED', suspendedReason: 'Account deleted', suspendedAt: now },
      }),
    ]);
  }

  private async createMerchantUser(clerkUserId: string, email: string): Promise<void> {
    try {
      await this.prisma.user.create({ data: { clerkUserId, email: normalizeEmail(email), role: 'MERCHANT' } });
    } catch (e) {
      // A concurrent first request (or the webhook) created it first; nothing left to do.
      if (isUniqueViolation(e)) return;
      throw e;
    }
    try {
      await this.clerk.setRole(clerkUserId, 'MERCHANT');
    } catch (e) {
      // publicMetadata only drives frontend routing; the DB role stays authoritative.
      this.logger.warn(`Could not mirror role to Clerk for ${clerkUserId}: ${String(e)}`);
    }
  }
}
