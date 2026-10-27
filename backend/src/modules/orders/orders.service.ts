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
import { isRetryableTransactionError, isUniqueViolation } from '../../prisma/errors.js';
import { TurnstileVerifier } from '../../common/security/turnstile.js';
import { answerIssues, readFormFields } from '../listings/form-fields.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { RegistrationConfirmedPayload } from '../notifications/templates.js';
import { assertOrderable, availabilityOf } from '../listings/availability.js';
import { StripeClient, stripeErrorCode } from '../stripe/stripe-client.js';
import type { CreateOrderDto, CreateOrderResultDto, PublicOrderDto } from './order.dto.js';
import {
  canSelfCancel,
  cancelFree,
  type CheckoutSessionRef,
  checkoutRequest,
  endUnpaid,
  expireSessions,
  lockOrder,
  type OrderDetail,
  orderDetail,
  recoverCheckoutSession,
  selfCancelDeadline,
  sessionsToEnd,
} from './order-ops.js';
import { type ItemQty, registerFree, reserve } from './reservation.js';
import { orderUrl } from './urls.js';

const ATTEMPTS = 3; // retries for a racing resubmit by the same email, a public-code collision or a deadlock

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
  const quantity = lines.reduce((sum, l) => sum + l.quantity, 0);
  if (quantity > listing.maxQtyPerOrder) {
    throw new AppError('QTY_EXCEEDS_LIMIT', 'Too many in one order', { max: listing.maxQtyPerOrder });
  }
  const hasPoint = listing.pickupPoints.some((p) => p.id === dto.pickupPointId);
  if (listing.fulfilment === 'PICKUP' && !hasPoint) throw new AppError('VALIDATION_FAILED', 'Choose a pickup point', ['pickupPointId']);
  if (listing.fulfilment !== 'PICKUP' && dto.pickupPointId) {
    throw new AppError('VALIDATION_FAILED', 'This listing has no pickup', ['pickupPointId']);
  }
  // Custom fields (DESIGN §9): order answers once, attendee answers once per place of each item.
  const fields = readFormFields(listing.formFields);
  const issues = answerIssues(fields, dto.formAnswers ?? {}, dto.items);
  if (issues.length) throw new AppError('VALIDATION_FAILED', 'Invalid answers', issues);
  return {
    lines: lines.map((l, n) => ({ ...l, attendeeAnswers: (dto.items[n].attendeeAnswers ?? []) as Prisma.InputJsonValue[] })),
    subtotalCents: lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0),
  };
}


@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeClient,
    private readonly turnstile: TurnstileVerifier,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** POST /public/listings/:shortCode/orders (DESIGN §7, §8.2): Checkout for paid listings, confirmed for free ones. */
  async create(shortCode: string, dto: CreateOrderDto, key: string | undefined, remoteIp?: string): Promise<CreateOrderResultDto> {
    if (!key || !isUUID(key)) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key header must be a UUID', ['Idempotency-Key']);
    // A replay needs no new Turnstile token (they are single-use); everything new is human-verified first.
    const replay = await this.replay(key);
    if (replay) return replay;
    if (!(await this.turnstile.verify(dto.turnstileToken, remoteIp))) throw new AppError('TURNSTILE_FAILED', 'Verification failed');

    const listing = await this.prisma.listing.findFirst({
      where: { shortCode, status: { not: 'DRAFT' } },
      include: {
        options: true,
        pickupPoints: { select: { id: true } },
        merchant: { select: { status: true, chargesEnabled: true, stripeAccountId: true } },
      },
    });
    if (!listing) throw new AppError('NOT_FOUND', 'Listing not found');
    assertOrderable(availabilityOf(listing, new Date()));
    const { lines, subtotalCents } = orderLines(listing, dto);
    const buyer = { name: dto.buyer.name.trim(), email: dto.buyer.email.trim(), phone: dto.buyer.phone.trim() };
    const common = {
      accessToken: accessToken(),
      listingId: listing.id,
      merchantId: listing.merchantId,
      pickupPointId: dto.pickupPointId ?? null,
      buyerName: buyer.name,
      buyerEmail: buyer.email,
      buyerPhone: buyer.phone,
      buyerNote: dto.note?.trim() || null,
      displayAnonymous: dto.anonymous,
      formAnswers: (dto.formAnswers ?? {}) as Prisma.InputJsonValue,
      onePerEmail: listing.onePerEmail,
      idempotencyKey: key,
      locale: dto.locale ?? DEFAULT_LOCALE,
      items: { create: lines },
    };
    if (listing.pricing === 'FREE') return this.register(listing.id, common, lines);
    if (!listing.merchant.chargesEnabled || !listing.merchant.stripeAccountId) {
      throw new AppError('MERCHANT_NOT_CHARGEABLE', 'This seller cannot take payments right now');
    }

    const data: Prisma.OrderUncheckedCreateInput = {
      ...common,
      publicCode: '',
      isFree: false,
      status: 'PENDING_PAYMENT',
      subtotalCents,
      platformFeeCents: platformFee(subtotalCents, this.env.PLATFORM_FEE_BPS, this.env.PLATFORM_FEE_FIXED_CENTS),
      totalCents: subtotalCents,
      reservationExpiresAt: new Date(Date.now() + this.env.RESERVATION_MINUTES * 60_000),
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
        if (isRetryableTransactionError(e) && attempt < ATTEMPTS) continue;
        if (!isUniqueViolation(e)) throw e;
        // The same key won a concurrent race: answer with that order (the index waited for its commit).
        const raced = await this.replay(key);
        if (raced) return raced;
        if (attempt >= ATTEMPTS) throw e;
      }
    }
    await expireSessions(this.stripe, this.logger, created.ended);

    const { order } = created;
    let session: { id: string; url: string };
    try {
      session = await this.stripe.createCheckoutSession(checkoutRequest(this.env, order));
    } catch (e) {
      // Stripe refused: no Checkout, no order. The places go back and the key is cleared so a retry starts afresh.
      await this.prisma.$transaction((tx) => endUnpaid(tx, order, 'EXPIRED', { idempotencyKey: null }));
      throw e;
    }
    // If this write is lost, a replay or the payment webhook recovers the session from Stripe.
    await this.prisma.order.updateMany({ where: { id: order.id, stripeCheckoutSessionId: null }, data: { stripeCheckoutSessionId: session.id } });
    return { kind: 'checkout', checkoutUrl: session.url };
  }

  /**
   * Free registration (DESIGN §7.6): straight to CONFIRMED with a sign-up number, never reserved, never expires.
   * onePerEmail: a second registration with the same email (any case) re-sends the first one's confirmation and is
   * refused with ALREADY_REGISTERED, without saying anything else about that registration.
   */
  private async register(
    listingId: string,
    common: Omit<Prisma.OrderUncheckedCreateInput, 'publicCode' | 'isFree' | 'status' | 'subtotalCents' | 'platformFeeCents' | 'totalCents'> & {
      idempotencyKey: string;
      onePerEmail: boolean;
    },
    lines: ItemQty[],
  ): Promise<CreateOrderResultDto> {
    const { onePerEmail } = common;
    if (onePerEmail) await this.refuseIfRegistered(listingId, common.buyerEmail);
    for (let attempt = 1; ; attempt++) {
      try {
        const order = await this.prisma.$transaction(async (tx) => {
          const seq = await registerFree(tx, listingId, lines);
          const order = await tx.order.create({
            data: { ...common, publicCode: publicCode(), isFree: true, status: 'CONFIRMED', sequenceNo: seq, subtotalCents: 0, platformFeeCents: 0, totalCents: 0 },
            include: orderDetail,
          });
          await this.notifications.enqueue(tx, this.confirmation(order, `REGISTRATION_CONFIRMED:${order.id}`));
          return order;
        });
        return { kind: 'confirmed', publicCode: order.publicCode, accessToken: order.accessToken };
      } catch (e) {
        if (isRetryableTransactionError(e) && attempt < ATTEMPTS) continue;
        if (!isUniqueViolation(e)) throw e;
        const raced = await this.replay(common.idempotencyKey);
        if (raced) return raced;
        // A concurrent registration with the same email won (order_one_per_email_live_key).
        if (onePerEmail) await this.refuseIfRegistered(listingId, common.buyerEmail);
        if (attempt >= ATTEMPTS) throw e;
      }
    }
  }

  private async refuseIfRegistered(listingId: string, email: string): Promise<void> {
    // The same rows order_one_per_email_live_key guards (the index is the race backstop).
    const order = await this.prisma.order.findFirst({
      where: { listingId, onePerEmail: true, buyerEmail: { equals: email, mode: 'insensitive' }, status: { in: ['CONFIRMED', 'FULFILLED'] } },
      include: orderDetail,
    });
    if (!order) return;
    // At most one re-send per hour, however often someone tries this email.
    const hour = new Date().toISOString().slice(0, 13);
    await this.notifications.enqueue(this.prisma, this.confirmation(order, `REGISTRATION_CONFIRMED:${order.id}:resend:${hour}`));
    throw new AppError('ALREADY_REGISTERED', 'This email is already registered');
  }

  private confirmation(order: OrderDetail, dedupeKey: string) {
    return {
      type: 'REGISTRATION_CONFIRMED',
      recipient: order.buyerEmail,
      locale: order.locale,
      payload: {
        publicCode: order.publicCode,
        listingTitle: order.listing.title,
        seq: order.sequenceNo!,
        items: order.items.map((i) => ({ name: i.option.name, quantity: i.quantity })),
        orderUrl: orderUrl(this.env, order.locale, order.publicCode, order.accessToken),
        pickup: order.pickupPoint && { label: order.pickupPoint.label, address: order.pickupPoint.address },
        selfCancelUntil: selfCancelDeadline(order)?.toISOString() ?? null,
        canSelfCancel: order.listing.allowSelfCancel,
      } satisfies RegistrationConfirmedPayload,
      dedupeKey,
    };
  }

  /** The first answer for an Idempotency-Key, or null when the key is new (§7.2). */
  private async replay(key: string): Promise<CreateOrderResultDto | null> {
    const order = await this.prisma.order.findUnique({ where: { idempotencyKey: key }, include: orderDetail });
    if (!order) return null;
    if (order.isFree) return { kind: 'confirmed', publicCode: order.publicCode, accessToken: order.accessToken };
    if (order.status !== 'PENDING_PAYMENT') {
      // Paid (or otherwise settled) already: send the buyer to their order page.
      return { kind: 'checkout', checkoutUrl: orderUrl(this.env, order.locale, order.publicCode, order.accessToken, true) };
    }
    const accountId = order.merchant.stripeAccountId!;
    if (order.stripeCheckoutSessionId) {
      // Read the session back rather than re-sending a request the merchant's later edits could have changed.
      const url = await this.stripe.retrieveCheckoutUrl(accountId, order.stripeCheckoutSessionId);
      return { kind: 'checkout', checkoutUrl: url ?? orderUrl(this.env, order.locale, order.publicCode, order.accessToken) };
    }
    // The first request has not saved its session (still running, or it died after Stripe answered). The same stored
    // request under the same idempotency key makes Stripe return that session, or tells us it is still being made.
    try {
      const session = await recoverCheckoutSession(this.prisma, this.stripe, this.env, order);
      return { kind: 'checkout', checkoutUrl: session.url };
    } catch (e) {
      if (stripeErrorCode(e) === 'idempotency_key_in_use') throw new AppError('ORDER_IN_PROGRESS', 'This order is still being created');
      throw e;
    }
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

  /**
   * POST /public/orders/:publicCode/cancel (X-Order-Token): a paid order while unpaid, or a free registration within
   * its self-cancel window (DESIGN §9), which gives its places back.
   */
  async cancel(code: string, token: string): Promise<PublicOrderDto> {
    const order = await this.prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, { publicCode: code });
      if (!order || !tokenMatches(order.accessToken, token)) throw new AppError('NOT_FOUND', 'Order not found');
      if (!order.isFree) await endUnpaid(tx, order, 'CANCELLED', { cancelledAt: new Date() });
      else {
        if (order.status === 'CONFIRMED' && !canSelfCancel(order, new Date())) {
          throw new AppError('SELF_CANCEL_WINDOW_PASSED', 'This registration can no longer be cancelled online');
        }
        await cancelFree(tx, order);
      }
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
    canCancel: (order.status === 'PENDING_PAYMENT' && !order.isFree) || canSelfCancel(order, new Date()),
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
    selfCancelUntil: selfCancelDeadline(order),
  };
}

function tokenMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
