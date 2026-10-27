import type { Logger } from '@nestjs/common';
import type { Env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CheckoutRequest, StripeClient } from '../stripe/stripe-client.js';
import { transitionOrder } from './order-state-machine.js';
import { release } from './reservation.js';
import { listingUrl, orderUrl } from './urls.js';

// What every order path loads: items with option names, the listing, the pickup point and the merchant's account.
export const orderDetail = {
  items: { select: { optionId: true, quantity: true, unitPriceCents: true, option: { select: { name: true } } } },
  listing: { select: { title: true, shortCode: true } },
  pickupPoint: { select: { label: true, address: true, windowStart: true, windowEnd: true, notes: true } },
  merchant: { select: { stripeAccountId: true } },
} satisfies Prisma.OrderInclude;

export type OrderDetail = Prisma.OrderGetPayload<{ include: typeof orderDetail }>;

/** Locks one order row (FOR UPDATE) and loads it; null when there is no such order. */
export async function lockOrder(
  tx: Prisma.TransactionClient,
  where: { id: string } | { publicCode: string },
): Promise<OrderDetail | null> {
  const [row] =
    'id' in where
      ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "order" WHERE id = ${where.id}::uuid FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "order" WHERE public_code = ${where.publicCode} FOR UPDATE`;
  return row ? tx.order.findUniqueOrThrow({ where: { id: row.id }, include: orderDetail }) : null;
}

/** Ends an unpaid order and gives its held places back (DESIGN §6: EXPIRED / CANCELLED release reserved stock). */
export async function endUnpaid(
  tx: Prisma.TransactionClient,
  order: OrderDetail,
  to: 'EXPIRED' | 'CANCELLED',
  data: Prisma.OrderUpdateManyMutationInput = {},
): Promise<void> {
  await transitionOrder(tx, order, to, data);
  await release(tx, order.listingId, order.items);
}

export interface CheckoutSessionRef {
  accountId: string;
  sessionId: string;
}

/** The order's Checkout session, if it has one, for ending after the transaction commits. */
export function sessionsToEnd(order: OrderDetail): CheckoutSessionRef[] {
  const accountId = order.merchant.stripeAccountId;
  return accountId && order.stripeCheckoutSessionId ? [{ accountId, sessionId: order.stripeCheckoutSessionId }] : [];
}

/** Best effort: an unended session still expires on its own at expires_at, and a late payment is handled (§7.5). */
export async function expireSessions(stripe: StripeClient, logger: Logger, sessions: CheckoutSessionRef[]): Promise<void> {
  for (const s of sessions) {
    try {
      await stripe.expireCheckoutSession(s.accountId, s.sessionId);
    } catch (e) {
      logger.warn(`could not expire Checkout ${s.sessionId}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

// Stripe requires a session to stay open at least 30 minutes from its creation, which happens a moment after the
// reservation deadline is stored. The session closes a little later; the expiry job ends it at the real deadline.
const CHECKOUT_HEADROOM_MS = 2 * 60_000;

/** Checkout's expires_at: the reservation deadline plus headroom, whole seconds (derived, so replays match). */
export function checkoutDeadline(reservationExpiresAt: Date): Date {
  return new Date(Math.ceil((reservationExpiresAt.getTime() + CHECKOUT_HEADROOM_MS) / 1000) * 1000);
}

/**
 * The Checkout request for an order, built only from what is stored. Replaying an Idempotency-Key sends exactly the
 * same request, so Stripe's idempotency returns the original session.
 */
export function checkoutRequest(env: Env, order: OrderDetail): CheckoutRequest {
  return {
    accountId: order.merchant.stripeAccountId!,
    orderId: order.id,
    lines: order.items.map((i) => ({ name: `${order.listing.title} · ${i.option.name}`, unitAmountCents: i.unitPriceCents, quantity: i.quantity })),
    applicationFeeCents: order.platformFeeCents,
    customerEmail: order.buyerEmail,
    expiresAt: checkoutDeadline(order.reservationExpiresAt!),
    successUrl: orderUrl(env, order.locale, order.publicCode, order.accessToken, true),
    cancelUrl: listingUrl(env, order.locale, order.listing.shortCode),
    locale: order.locale,
  };
}
