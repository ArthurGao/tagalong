import type { Env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { OrderRefundedPayload } from '../notifications/templates.js';
import { canTransition, transitionOrder } from './order-state-machine.js';
import type { OrderDetail } from './order-ops.js';
import { orderUrl } from './urls.js';

// Every platform refund is first recorded as a PENDING Refund row (decided, in flight), then sent to Stripe with the
// row id as idempotency key, then confirmed here. In-flight amounts count against what is still refundable, and
// charge.refunded subtracts them so a refund is never counted twice. (The late-payment refund in checkout-webhooks
// is the one exception: its order stays EXPIRED and its email differs.)

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

export interface RefundDeps {
  notifications: NotificationsService;
  env: Env;
}

/**
 * Stripe accepted refund `refundId`: record its answer (first writer wins) and settle the money, under the caller's
 * order lock. Returns false when another delivery already recorded it.
 */
export async function confirmRefund(
  tx: Prisma.TransactionClient,
  deps: RefundDeps,
  order: OrderDetail,
  refund: { id: string; amountCents: number; reason: string | null },
  stripeRefundId: string,
): Promise<boolean> {
  const { count } = await tx.refund.updateMany({ where: { id: refund.id, stripeRefundId: null }, data: { stripeRefundId, status: 'SUCCEEDED' } });
  if (count) await settleRefund(tx, deps, order, refund.amountCents, refund.id, refund.reason);
  return count > 0;
}

/**
 * Money that has gone back to the buyer (DESIGN §8.4): adds it to refundedCents, moves the order to REFUNDED or
 * PARTIALLY_REFUNDED where the state machine allows it, and queues the buyer's email. `dedupeKey` identifies this refund.
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
  else await tx.order.update({ where: { id: order.id }, data: { refundedCents } }); // e.g. a second partial refund
  await deps.notifications.enqueue(tx, {
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
    } satisfies OrderRefundedPayload,
    dedupeKey: `ORDER_REFUNDED:${dedupeKey}`,
  });
}
