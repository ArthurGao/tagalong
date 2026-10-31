import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { ListingStatus, OrderStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { type AuthUser, requireMerchantId } from '../auth/auth-user.js';
import { assertListingTransition } from '../listings/listing-state-machine.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { StripeClient } from '../stripe/stripe-client.js';
import type { CancelListingDto, CancellationPreviewDto, CancellationProgressDto } from './cancellation.dto.js';
import { cancelFreeWithEmail, type CheckoutSessionRef, endUnpaid, expireSessions, orderDetail, sessionsToEnd } from './order-ops.js';
import { assertRefundFits, pendingByOrder, queueRefunds, refundable } from './refunds.js';

interface EndRequest {
  listingId: string;
  actorUserId: string;
  reason: string;
  refundAll: boolean;
  onEnded?: (tx: Prisma.TransactionClient, cancellationId: string) => Promise<void>;
}

// Paid orders refunded when a listing is cancelled (DESIGN §8.5). FULFILLED orders keep their money: the goods were
// handed over, and the merchant can still refund one by one.
const TO_REFUND: OrderStatus[] = ['PAID', 'PARTIALLY_REFUNDED'];
// Every order a cancellation ends: refunded (TO_REFUND), expired (unpaid) or cancelled (free).
const ENDED: OrderStatus[] = [...TO_REFUND, 'PENDING_PAYMENT', 'CONFIRMED'];
const CANCEL_ROUNDS = 5;

/** A FAILED refund of a cancellation, as a retry reads it under lock. */
export interface FailedRefund {
  id: string;
  orderId: string;
  amountCents: number;
  stripeRefundId: string | null;
}

@Injectable()
export class CancellationService {
  private readonly logger = new Logger(CancellationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeClient,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get deps() {
    return { notifications: this.notifications, env: this.env };
  }

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
    await this.end({ listingId, actorUserId: user.id, reason: dto.reason, refundAll: true });
    return this.progressOf(listingId);
  }

  /**
   * Ends a listing for the admin console (a takedown, DESIGN §9). With `refundAll` it ends like a merchant cancellation
   * (paid orders refunded, registrations cancelled); without, orders keep their state and only unpaid checkouts end.
   * `onEnded` runs in the same transaction once the listing is CANCELLED (the caller's own fields, email and audit).
   */
  async endAsAdmin(
    actorUserId: string,
    listingId: string,
    request: { reason: string; refundAll: boolean },
    onEnded: (tx: Prisma.TransactionClient, cancellationId: string) => Promise<void>,
  ): Promise<void> {
    await this.end({ listingId, actorUserId, ...request, onEnded });
  }

  /**
   * Orders created while the scan below ran (their transaction held the listing) appear once we hold the listing:
   * then everything starts again, so no order escapes the cancellation. Order creation is brief; a few rounds do.
   */
  private async end(request: EndRequest): Promise<void> {
    for (let round = 0; round < CANCEL_ROUNDS; round++) {
      const ended = await this.endOnce(request);
      if (ended) {
        await expireSessions(this.stripe, this.logger, ended);
        return;
      }
    }
    throw new AppError('ORDER_IN_PROGRESS', 'Orders are still arriving; try again');
  }

  /** One attempt; null when an order appeared that it had not locked (nothing was written). */
  private async endOnce({ listingId, actorUserId, reason, refundAll, onEnded }: EndRequest): Promise<CheckoutSessionRef[] | null> {
    const ended: CheckoutSessionRef[] = [];
    // Not through ListingsService.mutate(): that path locks the listing first, and this one must lock the listing's
    // orders before it (order → listing, as every order path does). No revision check either: cancelling wins.
    const complete = await this.prisma.$transaction(
      async (tx) => {
        const lockedIds = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "order"
          WHERE listing_id = ${listingId}::uuid AND status::text IN (${Prisma.join(ENDED)})
          ORDER BY id FOR UPDATE`;
        const [locked] = await tx.$queryRaw<{ status: ListingStatus }[]>`
          SELECT status FROM listing WHERE id = ${listingId}::uuid FOR UPDATE`;
        if (!locked) throw new AppError('NOT_FOUND', 'Listing not found');
        assertListingTransition(locked.status, 'CANCELLED');
        // New orders need the listing lock, so from here none can appear; one committed before we got it was not locked.
        const missed = await tx.order.count({
          where: { listingId, status: { in: ENDED }, id: { notIn: lockedIds.map((o) => o.id) } },
        });
        if (missed) return false;
        await tx.listing.update({ where: { id: listingId }, data: { status: 'CANCELLED', cancelledAt: new Date(), revision: { increment: 1 } } });
        const cancellation = await tx.listingCancellation.create({
          data: { listingId, initiatedByUserId: actorUserId, reason, refundAll, status: 'RUNNING', startedAt: new Date() },
        });
        await onEnded?.(tx, cancellation.id);

        const orders = await tx.order.findMany({ where: { id: { in: lockedIds.map((o) => o.id) } }, include: orderDetail });
        const paid = orders.filter((o) => TO_REFUND.includes(o.status));
        const pending = await pendingByOrder(tx, paid.map((o) => o.id));
        for (const order of orders) {
          if (order.status === 'PENDING_PAYMENT') {
            await endUnpaid(tx, order, 'EXPIRED');
            ended.push(...sessionsToEnd(order));
          } else if (order.status === 'CONFIRMED' && refundAll) {
            await cancelFreeWithEmail(tx, this.deps, order, reason);
          }
        }
        const toRefund = paid
          .map((o) => ({ orderId: o.id, amountCents: refundable(o, pending.get(o.id) ?? 0), reason }))
          .filter((r) => refundAll && r.amountCents > 0);
        const tasks = await queueRefunds(tx, toRefund, cancellation.id);
        // A refund already in flight (a merchant refund) keeps it running too: refund.job finishes it once that settles.
        const inFlight = tasks.length > 0 || (refundAll && [...pending.values()].some((cents) => cents > 0));
        await tx.listingCancellation.update({
          where: { id: cancellation.id },
          data: inFlight ? { totalOrders: tasks.length } : { totalOrders: 0, status: 'COMPLETED', finishedAt: new Date() },
        });
        return true;
      },
      { timeout: 30_000 }, // one statement per unpaid or free order: a big listing needs more than the 5 s default
    );
    return complete ? ended : null;
  }

  /** GET /merchants/me/listings/:id/cancellation — the batch refund's progress, for polling. */
  async progress(user: AuthUser, listingId: string): Promise<CancellationProgressDto> {
    await this.ownListing(user, listingId);
    return this.progressOf(listingId);
  }

  /** A listing's cancellation progress, whoever asks (the owner above, or the admin console). */
  async progressOf(listingId: string): Promise<CancellationProgressDto> {
    const c = await this.prisma.listingCancellation.findUnique({ where: { listingId } });
    if (!c) throw new AppError('NOT_FOUND', 'This listing was not cancelled');
    const pending = (await this.pendingByListing([listingId])).get(listingId) ?? 0;
    return { status: c.status, totalOrders: c.totalOrders, succeeded: c.succeeded, failed: c.failed, pending, finishedAt: c.finishedAt };
  }

  /**
   * Refunds still in flight per listing, in one query: a cancellation's own, and any queued before it, which it waits
   * for. The "pending" of every progress figure (merchant and admin).
   */
  async pendingByListing(listingIds: string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<{ listing_id: string; pending: bigint }[]>`
      SELECT o.listing_id, count(*) AS pending FROM refund_task t JOIN "order" o ON o.id = t.order_id
      WHERE t.status = 'PENDING' AND o.listing_id = ANY(${listingIds}::uuid[]) GROUP BY o.listing_id`;
    return new Map(rows.map((r) => [r.listing_id, Number(r.pending)]));
  }

  /**
   * Puts FAILED refunds of a cancellation back in the queue (DESIGN §8.5: retried manually from the admin console), all
   * of them or one (`taskId`). One Stripe refused outright gets a new refund (a new id: its idempotency key would only
   * replay the refusal); one that ended on errors is tried again as itself, so the same key or metadata lookup keeps it
   * from refunding twice. Either way the money counts as in flight again, so it must still fit in what is refundable
   * (a refund made since may have used it). Locks the orders, then the tasks (order → task, as RefundProcessor), so a
   * concurrent retry finds them no longer FAILED. `onRetried` runs in the same transaction with the tasks it retried
   * (the admin's audit row).
   */
  async retryFailed(
    cancellationId: string,
    options: { taskId?: string; onRetried?: (tx: Prisma.TransactionClient, retried: FailedRefund[]) => Promise<void> } = {},
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const orderIds = (
        await tx.refundTask.findMany({ where: { cancellationId, status: 'FAILED', ...(options.taskId && { id: options.taskId }) }, select: { orderId: true } })
      ).map((t) => t.orderId);
      if (!orderIds.length) return 0;
      const orders = await tx.$queryRaw<{ id: string; total_cents: number; refunded_cents: number }[]>`
        SELECT id, total_cents, refunded_cents FROM "order" WHERE id = ANY(${orderIds}::uuid[]) ORDER BY id FOR UPDATE`;
      // Under the order locks, the tasks as they are now: a retry that committed meanwhile left them PENDING.
      const failed = await tx.$queryRaw<FailedRefund[]>`
        SELECT id, order_id AS "orderId", amount_cents AS "amountCents", stripe_refund_id AS "stripeRefundId" FROM refund_task
        WHERE cancellation_id = ${cancellationId}::uuid AND status = 'FAILED' AND order_id = ANY(${orderIds}::uuid[])
        ORDER BY id FOR UPDATE`;
      if (!failed.length) return 0;
      const pending = await pendingByOrder(tx, orderIds);
      const orderById = new Map(orders.map((o) => [o.id, o]));
      for (const task of failed) {
        const o = orderById.get(task.orderId)!;
        assertRefundFits(task.amountCents, refundable({ totalCents: o.total_cents, refundedCents: o.refunded_cents }, pending.get(o.id) ?? 0), { orderId: o.id });
      }
      const refused = failed.filter((t) => t.stripeRefundId);
      const unanswered = failed.filter((t) => !t.stripeRefundId).map((t) => t.id);
      await tx.refundTask.updateMany({
        where: { id: { in: unanswered } },
        data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null, leaseToken: null },
      });
      await tx.refund.updateMany({ where: { id: { in: unanswered } }, data: { status: 'PENDING' } });
      // The refused task makes way (one task per order and cancellation); its FAILED Refund row stays as the record.
      const reasons = new Map((await tx.refund.findMany({ where: { id: { in: refused.map((t) => t.id) } } })).map((r) => [r.id, r.reason]));
      await tx.refundTask.deleteMany({ where: { id: { in: refused.map((t) => t.id) } } });
      await queueRefunds(tx, refused.map((t) => ({ orderId: t.orderId, amountCents: t.amountCents, reason: reasons.get(t.id) ?? null })), cancellationId);
      await tx.listingCancellation.update({
        where: { id: cancellationId },
        data: { status: 'RUNNING', failed: { decrement: failed.length }, finishedAt: null },
      });
      await options.onRetried?.(tx, failed);
      return failed.length;
    });
  }

  private async ownListing(user: AuthUser, listingId: string) {
    const listing = await this.prisma.listing.findFirst({ where: { id: listingId, merchantId: requireMerchantId(user) }, select: { id: true, title: true } });
    if (!listing) throw new AppError('NOT_FOUND', 'Listing not found');
    return listing;
  }
}
