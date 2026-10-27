import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { AppError } from '../../common/errors/app-error.js';
import { accessToken, publicCode } from '../../common/ids.js';
import { DEFAULT_LOCALE } from '../../common/locale.js';
import { platformFee } from '../../common/money.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { isUniqueViolation } from '../../prisma/errors.js';
import { assertOrderable, availabilityOf } from '../listings/availability.js';
import { StripeClient } from '../stripe/stripe-client.js';
import type { CreateOrderDto, CreateOrderResultDto, PublicOrderDto } from './order.dto.js';
import {
  type CheckoutSessionRef,
  checkoutRequest,
  endUnpaid,
  expireSessions,
  lockOrder,
  type OrderDetail,
  orderDetail,
  sessionsToEnd,
} from './order-ops.js';
import { reserve } from './reservation.js';
import { orderUrl } from './urls.js';

const ATTEMPTS = 3; // retries for a racing resubmit by the same email, or a public-code collision

type OrderListing = Prisma.ListingGetPayload<{
  include: { options: true; pickupPoints: { select: { id: true } }; merchant: { select: { status: true; chargesEnabled: true; stripeAccountId: true } } };
}>;

/** Checks the request against the listing; prices and quantities come only from the database. */
function orderLines(listing: OrderListing, dto: CreateOrderDto) {
  const optionIds = dto.items.map((i) => i.optionId);
  if (new Set(optionIds).size !== optionIds.length) throw new AppError('VALIDATION_FAILED', 'Each option once', ['items']);
  const lines = dto.items.map((i) => {
    const option = listing.options.find((o) => o.id === i.optionId && o.active);
    if (!option) throw new AppError('VALIDATION_FAILED', 'Unknown option', ['items']);
    return { optionId: option.id, quantity: i.quantity, unitPriceCents: option.priceCents };
  });
  if (lines.reduce((sum, l) => sum + l.quantity, 0) > listing.maxQtyPerOrder) {
    throw new AppError('QTY_EXCEEDS_LIMIT', 'Too many in one order', { max: listing.maxQtyPerOrder });
  }
  const hasPoint = listing.pickupPoints.some((p) => p.id === dto.pickupPointId);
  if (listing.fulfilment === 'PICKUP' && !hasPoint) throw new AppError('VALIDATION_FAILED', 'Choose a pickup point', ['pickupPointId']);
  if (listing.fulfilment !== 'PICKUP' && dto.pickupPointId) {
    throw new AppError('VALIDATION_FAILED', 'This listing has no pickup', ['pickupPointId']);
  }
  return { lines, subtotalCents: lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0) };
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** POST /public/listings/:shortCode/orders (DESIGN §7, §8.2). Paid listings only until M5b. */
  async create(shortCode: string, dto: CreateOrderDto, key: string | undefined): Promise<CreateOrderResultDto> {
    if (!key || !isUUID(key)) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key header must be a UUID', ['Idempotency-Key']);
    const replay = await this.replay(key);
    if (replay) return replay;

    const listing = await this.prisma.listing.findFirst({
      where: { shortCode, status: { not: 'DRAFT' } },
      include: {
        options: true,
        pickupPoints: { select: { id: true } },
        merchant: { select: { status: true, chargesEnabled: true, stripeAccountId: true } },
      },
    });
    if (!listing) throw new AppError('NOT_FOUND', 'Listing not found');
    if (listing.pricing === 'FREE') throw new AppError('BAD_REQUEST', 'Free registration is not available yet');
    assertOrderable(availabilityOf(listing, new Date()));
    if (!listing.merchant.chargesEnabled || !listing.merchant.stripeAccountId) {
      throw new AppError('MERCHANT_NOT_CHARGEABLE', 'This seller cannot take payments right now');
    }
    const { lines, subtotalCents } = orderLines(listing, dto);
    const buyer = { name: dto.buyer.name.trim(), email: dto.buyer.email.trim(), phone: dto.buyer.phone.trim() };

    const data: Prisma.OrderUncheckedCreateInput = {
      publicCode: '',
      accessToken: accessToken(),
      listingId: listing.id,
      merchantId: listing.merchantId,
      pickupPointId: dto.pickupPointId ?? null,
      buyerName: buyer.name,
      buyerEmail: buyer.email,
      buyerPhone: buyer.phone,
      buyerNote: dto.note?.trim() || null,
      displayAnonymous: dto.anonymous,
      isFree: false,
      onePerEmail: listing.onePerEmail,
      idempotencyKey: key,
      locale: dto.locale ?? DEFAULT_LOCALE,
      status: 'PENDING_PAYMENT',
      subtotalCents,
      platformFeeCents: platformFee(subtotalCents, this.env.PLATFORM_FEE_BPS, this.env.PLATFORM_FEE_FIXED_CENTS),
      totalCents: subtotalCents,
      reservationExpiresAt: new Date(Date.now() + this.env.RESERVATION_MINUTES * 60_000),
      items: { create: lines },
    };

    let created: { order: OrderDetail; ended: CheckoutSessionRef[] } | undefined;
    for (let attempt = 1; !created; attempt++) {
      try {
        created = await this.prisma.$transaction(async (tx) => {
          // One unpaid order per email per listing (§7.2): a resubmit ends the earlier one first.
          const ended = await this.endPendingFor(tx, listing.id, buyer.email);
          await reserve(tx, listing.id, lines);
          const order = await tx.order.create({ data: { ...data, publicCode: publicCode() }, include: orderDetail });
          return { order, ended };
        });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        // The same key won a concurrent race: answer with that order (the index waited for its commit).
        const raced = await this.replay(key);
        if (raced) return raced;
        if (attempt >= ATTEMPTS) throw e;
      }
    }
    await expireSessions(this.stripe, this.logger, created.ended);

    const { order } = created;
    try {
      const session = await this.stripe.createCheckoutSession(checkoutRequest(this.env, order));
      await this.prisma.order.update({ where: { id: order.id }, data: { stripeCheckoutSessionId: session.id } });
      return { kind: 'checkout', checkoutUrl: session.url };
    } catch (e) {
      // No Checkout, no order: give the places back. The key is cleared so the buyer's retry starts afresh.
      await this.prisma.$transaction((tx) => endUnpaid(tx, order, 'EXPIRED', { idempotencyKey: null }));
      throw e;
    }
  }

  /** The first answer for an Idempotency-Key, or null when the key is new (§7.2). */
  private async replay(key: string): Promise<CreateOrderResultDto | null> {
    const order = await this.prisma.order.findUnique({ where: { idempotencyKey: key }, include: orderDetail });
    if (!order) return null;
    if (order.status !== 'PENDING_PAYMENT') {
      // Paid (or otherwise settled) already: send the buyer to their order page.
      return { kind: 'checkout', checkoutUrl: orderUrl(this.env, order.locale, order.publicCode, order.accessToken, true) };
    }
    // The first request is still between its commit and its Checkout call.
    if (!order.stripeCheckoutSessionId) throw new AppError('ORDER_IN_PROGRESS', 'This order is still being created');
    // Same stored request, same Stripe idempotency key: Stripe returns the session it created the first time.
    const session = await this.stripe.createCheckoutSession(checkoutRequest(this.env, order));
    return { kind: 'checkout', checkoutUrl: session.url };
  }

  /** Ends this email's unpaid order on the listing, if any; returns its Checkout session to end after commit. */
  private async endPendingFor(tx: Prisma.TransactionClient, listingId: string, email: string): Promise<CheckoutSessionRef[]> {
    const [pending] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "order"
      WHERE listing_id = ${listingId}::uuid AND lower(buyer_email) = lower(${email}) AND status = 'PENDING_PAYMENT'`;
    const order = pending && (await lockOrder(tx, { id: pending.id }));
    if (!order || order.status !== 'PENDING_PAYMENT') return [];
    await endUnpaid(tx, order, 'EXPIRED');
    return sessionsToEnd(order);
  }

  /** GET /public/orders/:publicCode (X-Order-Token) — the buyer's own order; a wrong token looks exactly like no order. */
  async get(code: string, token: string): Promise<PublicOrderDto> {
    const order = await this.prisma.order.findUnique({ where: { publicCode: code }, include: orderDetail });
    if (!order || !tokenMatches(order.accessToken, token)) throw new AppError('NOT_FOUND', 'Order not found');
    return toPublicOrder(order);
  }

  /** POST /public/orders/:publicCode/cancel (X-Order-Token) — paid orders while unpaid only (free self-cancel is M5b). */
  async cancel(code: string, token: string): Promise<PublicOrderDto> {
    const order = await this.prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, { publicCode: code });
      if (!order || !tokenMatches(order.accessToken, token)) throw new AppError('NOT_FOUND', 'Order not found');
      await endUnpaid(tx, order, 'CANCELLED', { cancelledAt: new Date() });
      return order;
    });
    await expireSessions(this.stripe, this.logger, sessionsToEnd(order));
    return toPublicOrder({ ...order, status: 'CANCELLED' });
  }
}

function toPublicOrder(order: OrderDetail): PublicOrderDto {
  return {
    publicCode: order.publicCode,
    status: order.status,
    isFree: order.isFree,
    canCancel: order.status === 'PENDING_PAYMENT' && !order.isFree,
    sequenceNo: order.sequenceNo,
    buyerName: order.buyerName,
    items: order.items.map((i) => ({ name: i.option.name, quantity: i.quantity, unitPriceCents: i.unitPriceCents })),
    subtotalCents: order.subtotalCents,
    totalCents: order.totalCents,
    refundedCents: order.refundedCents,
    pickupPoint: order.pickupPoint,
    listing: order.listing,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    reservationExpiresAt: order.reservationExpiresAt,
  };
}

function tokenMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
