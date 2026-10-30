import { randomUUID } from 'node:crypto';
import type { Env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { canTransition, ENDED_UNPAID, transitionOrder } from './order-state-machine.js';
import { merchantLine, type OrderDetail } from './order-ops.js';
import { listingUrl, orderUrl } from './urls.js';

// Every platform refund (merchant, late payment, listing cancellation) is a Refund row and a RefundTask with the same
// id, written under the order lock (decided, in flight), then carried out by RefundProcessor: Stripe gets the row id as
// idempotency key and metadata, and only a refund Stripe reports `succeeded` moves money here. In-flight amounts count
// against what is still refundable; charge.refunded matches Stripe's refunds to rows by id (DESIGN §8.4).

/** How long a worker holds a claimed task before another may take it over. */
export const LEASE_MS = 5 * 60_000;

/** Refunds decided but not yet confirmed by Stripe, per order, in one query. */
export async function pendingByOrder(tx: Prisma.TransactionClient, orderIds: string[]): Promise<Map<string, number>> {
  const rows = await tx.refund.groupBy({ by: ['orderId'], where: { orderId: { in: orderIds }, status: 'PENDING' }, _sum: { amountCents: true } });
  return new Map(rows.map((r) => [r.orderId, r._sum.amountCents ?? 0]));
}

/** What may still be refunded: the total, less what is refunded or on its way back. */
export function refundable(order: { totalCents: number; refundedCents: number }, pendingCents: number): number {
  return order.totalCents - order.refundedCents - pendingCents;
}

export async function refundableCents(tx: Prisma.TransactionClient, order: { id: string; totalCents: number; refundedCents: number }) {
  return refundable(order, (await pendingByOrder(tx, [order.id])).get(order.id) ?? 0);
}

/** For the merchant's list, in one query: per order, the amount in flight and whether the latest refund failed. */
export async function refundStateByOrder(db: Prisma.TransactionClient, orderIds: string[]) {
  const rows = await db.refund.findMany({
    where: { orderId: { in: orderIds } },
    orderBy: { createdAt: 'desc' },
    select: { orderId: true, status: true, amountCents: true },
  });
  const pending = new Map<string, number>();
  const lastFailed = new Set<string>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.status === 'PENDING') pending.set(r.orderId, (pending.get(r.orderId) ?? 0) + r.amountCents);
    if (!seen.has(r.orderId) && r.status === 'FAILED') lastFailed.add(r.orderId);
    seen.add(r.orderId);
  }
  return { pending, lastFailed };
}

/** A task as a worker holds it. `leaseToken` must still match for any of its writes to land. */
export interface ClaimedRefund {
  id: string;
  orderId: string;
  amountCents: number;
  attempts: number;
  cancellationId: string | null;
  stripeRefundId: string | null;
  createdAt: Date;
  leaseToken: string;
}

/** A task this worker still holds: once its lease has passed to another worker, no write of this one applies. */
export const stillHeld = (task: ClaimedRefund) => ({ id: task.id, status: 'PENDING' as const, leaseToken: task.leaseToken });

/**
 * Decides refunds under the caller's order locks: per refund a PENDING Refund row and a RefundTask with the same id
 * (the one rule RefundProcessor, markRefundSucceeded and retries rely on). Tasks of a cancellation wait for refund.job;
 * a single refund (merchant, late payment) is returned already claimed, so the caller can try it at once, and if the
 * caller dies refund.job takes it over after the lease.
 */
export async function queueRefunds(
  tx: Prisma.TransactionClient,
  refunds: { orderId: string; amountCents: number; reason: string | null }[],
  cancellationId: string | null,
  now = new Date(),
): Promise<ClaimedRefund[]> {
  const leaseToken = randomUUID();
  const claim = cancellationId ? {} : { leaseToken, nextAttemptAt: new Date(now.getTime() + LEASE_MS) };
  const tasks = await tx.refundTask.createManyAndReturn({
    data: refunds.map((r) => ({ cancellationId, orderId: r.orderId, amountCents: r.amountCents, ...claim })),
  });
  await tx.refund.createMany({
    data: tasks.map((t, i) => ({ id: t.id, orderId: t.orderId, amountCents: t.amountCents, reason: refunds[i].reason, status: 'PENDING' as const })),
  });
  return tasks.map((t) => ({ ...t, leaseToken }));
}

/** One refund decided under the caller's order lock, claimed for an immediate try. */
export async function queueRefund(tx: Prisma.TransactionClient, refund: { orderId: string; amountCents: number; reason: string | null }) {
  const [task] = await queueRefunds(tx, [refund], null);
  return task;
}

export interface RefundDeps {
  notifications: NotificationsService;
  env: Env;
}

/**
 * Stripe reports a refund carrying `metadata.refundId` succeeded. Metadata alone proves nothing (a merchant can type any
 * metadata on a Dashboard refund), so it counts as ours only for this order's row, for the row's amount, and for the
 * Stripe refund the row already knows if it knows one. Then the row and task are marked (a FAILED one included: Stripe
 * is the authority), the cancellation's counts follow, and the money is settled. Runs under the caller's order lock.
 */
export async function markRefundSucceeded(
  tx: Prisma.TransactionClient,
  deps: RefundDeps,
  order: OrderDetail,
  stripeRefund: { id: string; amountCents: number; refundId: string },
): Promise<'settled' | 'recorded' | 'not-ours'> {
  const refundId = stripeRefund.refundId;
  const stripeRefundId = stripeRefund.id;
  const row = await tx.refund.findUnique({ where: { id: refundId } });
  if (!row || row.orderId !== order.id || row.amountCents !== stripeRefund.amountCents) return 'not-ours';
  if (row.stripeRefundId && row.stripeRefundId !== stripeRefundId) return 'not-ours';
  if (row.status === 'SUCCEEDED') return 'recorded';
  await tx.refund.update({ where: { id: refundId }, data: { status: 'SUCCEEDED', stripeRefundId } });
  const task = await tx.refundTask.findUnique({ where: { id: refundId } });
  if (task) {
    await tx.refundTask.update({ where: { id: refundId }, data: { status: 'SUCCEEDED', stripeRefundId, leaseToken: null } });
    if (task.cancellationId) {
      const c = await tx.listingCancellation.update({
        where: { id: task.cancellationId },
        data: { succeeded: { increment: 1 }, ...(task.status === 'FAILED' && { failed: { decrement: 1 } }) },
      });
      // A refund given up on that Stripe later completed: a finished cancellation may have had its last failure.
      if (c.status === 'COMPLETED_WITH_FAILURES' && c.failed === 0) {
        await tx.listingCancellation.update({ where: { id: c.id }, data: { status: 'COMPLETED' } });
      }
    }
  }
  await settleRefund(tx, deps, order, row.amountCents, refundId, row.reason);
  return 'settled';
}

/**
 * Money that has gone back to the buyer (DESIGN §8.4): adds it to refundedCents, moves the order to REFUNDED or
 * PARTIALLY_REFUNDED where the state machine allows it, and queues the buyer's email (one per `dedupeKey`, i.e. per
 * refund). An order that never became PAID (a late payment, §7.5) keeps its status and gets the auto-refund email.
 */
export async function settleRefund(
  tx: Prisma.TransactionClient,
  deps: RefundDeps,
  order: OrderDetail,
  amountCents: number,
  dedupeKey: string,
  reason: string | null,
): Promise<void> {
  const refundedCents = order.refundedCents + amountCents;
  const to = refundedCents >= order.totalCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  if (canTransition(order.isFree, order.status, to)) await transitionOrder(tx, order, to, { refundedCents });
  else await tx.order.update({ where: { id: order.id }, data: { refundedCents } }); // a second partial refund, or never paid
  const neverPaid = ENDED_UNPAID.includes(order.status);
  await deps.notifications.enqueue(
    tx,
    neverPaid
      ? {
          type: 'ORDER_AUTO_REFUNDED',
          recipient: order.buyerEmail,
          locale: order.locale,
          payload: {
            publicCode: order.publicCode,
            listingTitle: order.listing.title,
            totalCents: amountCents,
            listingUrl: listingUrl(deps.env, order.locale, order.listing.shortCode),
          },
          dedupeKey: `ORDER_AUTO_REFUNDED:${dedupeKey}`,
        }
      : {
          type: 'ORDER_REFUNDED',
          recipient: order.buyerEmail,
          locale: order.locale,
          payload: {
            publicCode: order.publicCode,
            listingTitle: order.listing.title,
            amountCents,
            refundedCents,
            totalCents: order.totalCents,
            reason,
            orderUrl: orderUrl(deps.env, order.locale, order.publicCode, order.accessToken),
            merchant: merchantLine(order),
          },
          dedupeKey: `ORDER_REFUNDED:${dedupeKey}`,
        },
  );
}
