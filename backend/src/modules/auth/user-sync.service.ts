import { Injectable, Logger } from '@nestjs/common';
import { normalizeEmail } from '../../common/email.js';
import { isUniqueViolation } from '../../prisma/errors.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ClerkAdminApi } from './clerk.js';

const withMerchant = { merchant: { select: { id: true } } } as const;

/** Placeholder email for a tombstone: user.deleted carries no email, and deleted rows are outside the email index. */
const tombstoneEmail = (clerkUserId: string) => `deleted:${clerkUserId}`;

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
    await this.createMerchantUser(clerkUserId, await this.clerk.getPrimaryEmail(clerkUserId), null);
    return this.prisma.user.findUniqueOrThrow({ where: { clerkUserId }, include: withMerchant });
  }

  /**
   * Webhook path (user.created / user.updated). Idempotent and order-tolerant: a deleted user is never
   * revived, an event older than the last applied one is ignored, and the role never changes.
   */
  async upsertFromClerk(clerkUserId: string, email: string, clerkUpdatedAt: Date): Promise<void> {
    if (await this.applyIfNewer(clerkUserId, email, clerkUpdatedAt)) return;
    // Nothing applied: the row is deleted or already newer, or there is no row yet.
    if (await this.prisma.user.findUnique({ where: { clerkUserId }, select: { id: true } })) return;
    // A concurrent create of the same user won: apply this event to its row by the same rule.
    if (!(await this.createMerchantUser(clerkUserId, email, clerkUpdatedAt))) await this.applyIfNewer(clerkUserId, email, clerkUpdatedAt);
  }

  /** One conditional write, so overlapping events cannot both pass the check: only a newer event, never on a deleted user. */
  private async applyIfNewer(clerkUserId: string, email: string, clerkUpdatedAt: Date): Promise<boolean> {
    const { count } = await this.prisma.user.updateMany({
      where: { clerkUserId, deletedAt: null, OR: [{ clerkUpdatedAt: null }, { clerkUpdatedAt: { lt: clerkUpdatedAt } }] },
      data: { email: normalizeEmail(email), clerkUpdatedAt },
    });
    return count > 0;
  }

  /**
   * user.deleted: soft-delete and suspend the merchant; orders and money records stay. A deletion that
   * arrives before the user exists here leaves a tombstone, so a late user.created cannot revive it.
   */
  async softDelete(clerkUserId: string): Promise<void> {
    const now = new Date();
    const { count } = await this.prisma.user.updateMany({ where: { clerkUserId }, data: { deletedAt: now } });
    if (count === 0) {
      try {
        await this.prisma.user.create({ data: { clerkUserId, email: tombstoneEmail(clerkUserId), deletedAt: now } });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        // Created concurrently (JIT or user.created): delete that row instead.
        await this.prisma.user.updateMany({ where: { clerkUserId }, data: { deletedAt: now } });
      }
    }
    await this.prisma.merchant.updateMany({
      where: { owner: { clerkUserId }, status: 'ACTIVE' },
      data: { status: 'SUSPENDED', suspendedReason: 'Account deleted', suspendedAt: now },
    });
  }

  /** Creates the user as a MERCHANT; false when a concurrent create of the same Clerk user got there first. */
  private async createMerchantUser(clerkUserId: string, email: string, clerkUpdatedAt: Date | null): Promise<boolean> {
    try {
      await this.prisma.user.create({
        data: { clerkUserId, email: normalizeEmail(email), role: 'MERCHANT', clerkUpdatedAt },
      });
    } catch (e) {
      // Only a concurrent create of the same Clerk user is benign; an email held by another live
      // account is a real conflict and must surface (and make Svix retry) rather than be swallowed.
      if (isUniqueViolation(e) && (await this.prisma.user.findUnique({ where: { clerkUserId } }))) return false;
      throw e;
    }
    try {
      await this.clerk.setRole(clerkUserId, 'MERCHANT');
    } catch (e) {
      // publicMetadata only drives frontend routing; the DB role stays authoritative.
      this.logger.warn(`Could not mirror role to Clerk for ${clerkUserId}: ${String(e)}`);
    }
    return true;
  }
}
