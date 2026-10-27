import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { ListingStatus, OrderStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { type AuthUser, requireMerchantId } from '../auth/auth-user.js';
import { assertListingTransition } from '../listings/listing-state-machine.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { StripeClient } from '../stripe/stripe-client.js';
import type { CancelListingDto, CancellationPreviewDto, CancellationProgressDto } from './cancellation.dto.js';
import { cancelFreeWithEmail, type CheckoutSessionRef, endUnpaid, expireSessions, orderDetail, sessionsToEnd } from './order-ops.js';
import { pendingByOrder, refundable } from './refunds.js';

// Paid orders refunded when a listing is cancelled (DESIGN §8.5). FULFILLED orders keep their money: the goods were
// handed over, and the merchant can still refund one by one.
const TO_REFUND: OrderStatus[] = ['PAID', 'PARTIALLY_REFUNDED'];

@Injectable()
export class CancellationService {
  private readonly logger = new Logger(CancellationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeClient,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** What a cancellation would do, for the confirmation dialog. */
  async preview(user: AuthUser, listingId: string): Promise<CancellationPreviewDto> {
    await this.ownListing(user, listingId);
    const [groups, pending] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['status'],
        where: { listingId, status: { in: [...TO_REFUND, 'CONFIRMED', 'PENDING_PAYMENT'] } },
        _count: true,
        _sum: { totalCents: true, refundedCents: true },
      }),
      this.prisma.refund.aggregate({ where: { status: 'PENDING', order: { listingId, status: { in: TO_REFUND } } }, _sum: { amountCents: true } }),
    ]);
    const paid = groups.filter((g) => TO_REFUND.includes(g.status));
    const count = (status: OrderStatus) => groups.find((g) => g.status === status)?._count ?? 0;
    return {
      paidOrders: paid.reduce((n, g) => n + g._count, 0),
      refundTotalCents: paid.reduce((n, g) => n + (g._sum.totalCents ?? 0) - (g._sum.refundedCents ?? 0), 0) - (pending._sum.amountCents ?? 0),
      registrations: count('CONFIRMED'),
      unpaidOrders: count('PENDING_PAYMENT'),
    };
  }

  /**
   * Cancels the whole listing at once (DESIGN §8.5): CANCELLED now, unpaid checkouts ended, free registrations
   * cancelled with an email, and one RefundTask per paid order for refund.job. Each task's Refund row is created with
   * it (same id), so in-flight money is on record before Stripe is called.
   */
  async cancel(user: AuthUser, listingId: string, dto: CancelListingDto): Promise<CancellationProgressDto> {
    const listing = await this.ownListing(user, listingId);
    if (dto.confirmTitle.trim() !== listing.title.trim()) {
      throw new AppError('VALIDATION_FAILED', 'Type the listing title to confirm', ['confirmTitle']);
    }
    const ended: CheckoutSessionRef[] = [];
    // Not through ListingsService.mutate(): that path locks the listing first, and this one must lock the listing's
    // orders before it (order → listing, as every order path does). No revision check either: cancelling wins.
    await this.prisma.$transaction(
      async (tx) => {
        const lockedIds = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "order"
          WHERE listing_id = ${listingId}::uuid AND status IN ('PENDING_PAYMENT', 'PAID', 'PARTIALLY_REFUNDED', 'CONFIRMED')
          ORDER BY id FOR UPDATE`;
        const [locked] = await tx.$queryRaw<{ status: ListingStatus }[]>`
          SELECT status FROM listing WHERE id = ${listingId}::uuid FOR UPDATE`;
        assertListingTransition(locked.status, 'CANCELLED');
        await tx.listing.update({ where: { id: listingId }, data: { status: 'CANCELLED', revision: { increment: 1 } } });
        const cancellation = await tx.listingCancellation.create({
          data: { listingId, initiatedByUserId: user.id, reason: dto.reason, refundAll: true, status: 'RUNNING', startedAt: new Date() },
        });

        const orders = await tx.order.findMany({ where: { id: { in: lockedIds.map((o) => o.id) } }, include: orderDetail });
        const paid = orders.filter((o) => TO_REFUND.includes(o.status));
        const pending = await pendingByOrder(tx, paid.map((o) => o.id));
        for (const order of orders) {
          if (order.status === 'PENDING_PAYMENT') {
            await endUnpaid(tx, order, 'EXPIRED');
            ended.push(...sessionsToEnd(order));
          } else if (order.status === 'CONFIRMED') {
            await cancelFreeWithEmail(tx, { notifications: this.notifications, env: this.env }, order, dto.reason);
          }
        }
        const toRefund = paid
          .map((o) => ({ cancellationId: cancellation.id, orderId: o.id, amountCents: refundable(o, pending.get(o.id) ?? 0) }))
          .filter((t) => t.amountCents > 0);
        const tasks = await tx.refundTask.createManyAndReturn({ data: toRefund, select: { id: true, orderId: true, amountCents: true } });
        await tx.refund.createMany({ data: tasks.map((t) => ({ ...t, reason: dto.reason, status: 'PENDING' as const })) });
        await tx.listingCancellation.update({
          where: { id: cancellation.id },
          data: tasks.length ? { totalOrders: tasks.length } : { totalOrders: 0, status: 'COMPLETED', finishedAt: new Date() },
        });
      },
      { timeout: 30_000 }, // one statement per unpaid or free order: a big listing needs more than the 5 s default
    );
    await expireSessions(this.stripe, this.logger, ended);
    return this.progress(user, listingId);
  }

  /** GET /merchants/me/listings/:id/cancellation — the batch refund's progress, for polling. */
  async progress(user: AuthUser, listingId: string): Promise<CancellationProgressDto> {
    await this.ownListing(user, listingId);
    const c = await this.prisma.listingCancellation.findUnique({ where: { listingId } });
    if (!c) throw new AppError('NOT_FOUND', 'This listing was not cancelled');
    const pending = await this.prisma.refundTask.count({ where: { cancellationId: c.id, status: 'PENDING' } });
    return { status: c.status, totalOrders: c.totalOrders, succeeded: c.succeeded, failed: c.failed, pending, finishedAt: c.finishedAt };
  }

  /**
   * Puts FAILED refunds of a cancellation back in the queue (DESIGN §8.5: retried manually from the admin console, M8).
   * Their Refund rows go back to PENDING too, so the money counts as in flight again.
   */
  async retryFailed(cancellationId: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const failed = await tx.refundTask.findMany({ where: { cancellationId, status: 'FAILED' }, select: { id: true } });
      if (!failed.length) return 0;
      const ids = failed.map((t) => t.id);
      await tx.refundTask.updateMany({ where: { id: { in: ids } }, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null } });
      await tx.refund.updateMany({ where: { id: { in: ids } }, data: { status: 'PENDING' } });
      await tx.listingCancellation.update({
        where: { id: cancellationId },
        data: { status: 'RUNNING', failed: { decrement: ids.length }, finishedAt: null },
      });
      return ids.length;
    });
  }

  private async ownListing(user: AuthUser, listingId: string) {
    const listing = await this.prisma.listing.findFirst({ where: { id: listingId, merchantId: requireMerchantId(user) } });
    if (!listing) throw new AppError('NOT_FOUND', 'Listing not found');
    return listing;
  }
}
