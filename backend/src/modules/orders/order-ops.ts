import type { Logger } from '@nestjs/common';
import type { Env } from '../../config/env.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { RegistrationCancelledPayload } from '../notifications/templates.js';
import type { CheckoutRequest, StripeClient } from '../stripe/stripe-client.js';
import { transitionOrder } from './order-state-machine.js';
import { release, releaseSold } from './reservation.js';
import { listingUrl, orderUrl } from './urls.js';

// What every order path loads: items with option names, the listing, the pickup point and the merchant's account.
export const orderDetail = {
  items: { select: { optionId: true, quantity: true, unitPriceCents: true, option: { select: { name: true } } } },
  listing: { select: { title: true, shortCode: true, allowSelfCancel: true, selfCancelUntil: true } },
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

/** A free registration cancelled (by its buyer or the merchant): places go back (DESIGN §6). */
export async function cancelFree(tx: Prisma.TransactionClient, order: OrderDetail): Promise<void> {
  await transitionOrder(tx, order, 'CANCELLED', { cancelledAt: new Date() });
  await releaseSold(tx, order.listingId, order.items);
}

/** A free registration cancelled by the merchant (one order or the whole listing): the buyer is told why. */
export async function cancelFreeWithEmail(
  tx: Prisma.TransactionClient,
  deps: { notifications: NotificationsService; env: Env },
  order: OrderDetail,
  reason: string,
): Promise<void> {
  await cancelFree(tx, order);
  await deps.notifications.enqueue(tx, {
    type: 'REGISTRATION_CANCELLED',
    recipient: order.buyerEmail,
    locale: order.locale,
    payload: {
      listingTitle: order.listing.title,
      reason,
      listingUrl: listingUrl(deps.env, order.locale, order.listing.shortCode),
    } satisfies RegistrationCancelledPayload,
    dedupeKey: `REGISTRATION_CANCELLED:${order.id}`,
  });
}

/** Until when the buyer may cancel a free registration online (DESIGN §9); null when never or without a deadline. */
export function selfCancelDeadline(order: OrderDetail): Date | null {
  return order.isFree && order.listing.allowSelfCancel ? order.listing.selfCancelUntil : null;
}

export function canSelfCancel(order: OrderDetail, now: Date): boolean {
  const deadline = selfCancelDeadline(order);
  return order.isFree && order.status === 'CONFIRMED' && order.listing.allowSelfCancel && (!deadline || now < deadline);
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
 * The order's Checkout session when the request that opened it died before saving its id: the same stored request
 * under the same idempotency key makes Stripe return that session, never a new one. Saves the id (first writer wins).
 */
export async function recoverCheckoutSession(
  prisma: Pick<PrismaClient, 'order'>,
  stripe: StripeClient,
  env: Env,
  order: OrderDetail,
): Promise<{ id: string; url: string }> {
  const session = await stripe.createCheckoutSession(checkoutRequest(env, order));
  await prisma.order.updateMany({ where: { id: order.id, stripeCheckoutSessionId: null }, data: { stripeCheckoutSessionId: session.id } });
  return session;
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
