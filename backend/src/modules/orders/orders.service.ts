import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { AppError } from '../../common/errors/app-error.js';
import { normalizeEmail } from '../../common/email.js';
import { accessToken, publicCode } from '../../common/ids.js';
import { DEFAULT_LOCALE } from '../../common/locale.js';
import { utcHour } from '../../common/time.js';
import { platformFee } from '../../common/money.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { isRetryableTransactionError, isUniqueViolation } from '../../prisma/errors.js';
import { TurnstileVerifier } from '../../common/security/turnstile.js';
import { answerIssues, readFormFields } from '../listings/form-fields.js';
import { icsCalendar } from '../notifications/ics.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { assertOrderable, availabilityOf } from '../listings/availability.js';
import { StripeClient, stripeErrorCode } from '../stripe/stripe-client.js';
import type { CreateOrderDto, CreateOrderResultDto, PublicOrderDto, RecoverOrdersDto, RecoverOrdersResultDto } from './order.dto.js';
import {
  canSelfCancel,
  calendarEvents,
  cancelFree,
  type CheckoutSessionRef,
  checkoutRequest,
  confirmationBase,
  endUnpaid,
  expireSessions,
  hasCalendar,
  lockOrder,
  type OrderDetail,
  orderDetail,
  recoverCheckoutSession,
  saveCheckoutSession,
  selfCancelDeadline,
  sessionsToEnd,
} from './order-ops.js';
import { type ItemQty, registerFree, reserve } from './reservation.js';
import { orderUrl } from './urls.js';

const ATTEMPTS = 3; // retries for a racing resubmit by the same email, a public-code collision or a deadlock

const orderListing = {
  options: true,
  pickupPoints: { select: { id: true } },
  merchant: { select: { status: true, chargesEnabled: true, stripeAccountId: true } },
} satisfies Prisma.ListingInclude;
type OrderListing = Prisma.ListingGetPayload<{ include: typeof orderListing }>;

/** Checks the request against the listing; prices and quantities come only from the database. */
function orderLines(listing: OrderListing, dto: CreateOrderDto) {
  const optionIds = dto.items.map((i) => i.optionId);
  if (new Set(optionIds).size !== optionIds.length) throw new AppError('VALIDATION_FAILED', 'Each option once', ['items']);
  const lines = dto.items.map((i) => {
    const option = listing.options.find((o) => o.id === i.optionId && o.active);
    if (!option) throw new AppError('VALIDATION_FAILED', 'Unknown option', ['items']);
    // The Checkout line name is fixed now: a recovered session must replay exactly this request (DESIGN §7.2).
    return { optionId: option.id, quantity: i.quantity, unitPriceCents: option.priceCents, checkoutName: `${listing.title} · ${option.name}` };
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
    onePerEmail: listing.onePerEmail,
  };
}

/**
 * The order checked again on the listing as locked by reserve / registerFree: an edit committed after the first check
 * (a new required field, a lower limit, a price) applies to this order too. Throwing rolls the reservation back.
 */
async function lockedOrderLines(tx: Prisma.TransactionClient, listingId: string, dto: CreateOrderDto) {
  return orderLines(await tx.listing.findUniqueOrThrow({ where: { id: listingId }, include: orderListing }), dto);
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
    await this.assertHuman(dto.turnstileToken, remoteIp);

    const listing = await this.prisma.listing.findFirst({ where: { shortCode, status: { not: 'DRAFT' } }, include: orderListing });
    if (!listing) throw new AppError('NOT_FOUND', 'Listing not found');
    assertOrderable(availabilityOf(listing, new Date()));
    // Fails fast; the transaction checks again under the listing lock and stores that result.
    orderLines(listing, dto);
    const quantities: ItemQty[] = dto.items.map((i) => ({ optionId: i.optionId, quantity: i.quantity }));
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
      idempotencyKey: key,
      locale: dto.locale ?? DEFAULT_LOCALE,
    };
    if (listing.pricing === 'FREE') return this.register(listing.id, common, listing.onePerEmail, dto, quantities);
    if (!listing.merchant.chargesEnabled || !listing.merchant.stripeAccountId) {
      throw new AppError('MERCHANT_NOT_CHARGEABLE', 'This seller cannot take payments right now');
    }

    const reservationExpiresAt = new Date(Date.now() + this.env.RESERVATION_MINUTES * 60_000);

    const created = await retryTransaction(
      () =>
        this.prisma.$transaction(async (tx) => {
          // One unpaid order per email per listing (§7.2): a resubmit ends the earlier one first.
          const ended = await this.endPendingFor(tx, listing.id, buyer.email);
          await reserve(tx, listing.id, quantities);
          const { lines, subtotalCents, onePerEmail } = await lockedOrderLines(tx, listing.id, dto);
          const order = await tx.order.create({
            data: {
              ...common,
              onePerEmail,
              items: { create: lines },
              publicCode: publicCode(),
              isFree: false,
              status: 'PENDING_PAYMENT',
              subtotalCents,
              platformFeeCents: platformFee(subtotalCents, this.env.PLATFORM_FEE_BPS, this.env.PLATFORM_FEE_FIXED_CENTS),
              totalCents: subtotalCents,
              reservationExpiresAt,
            },
            include: orderDetail,
          });
          return { order, ended };
        }),
      // The same key won a concurrent race: answer with that order (the index waited for its commit).
      () => this.replay(key),
    );
    if ('kind' in created) return created;
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
    await saveCheckoutSession(this.prisma, order.id, session.id);
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
    },
    onePerEmail: boolean,
    dto: CreateOrderDto,
    quantities: ItemQty[],
  ): Promise<CreateOrderResultDto> {
    if (onePerEmail) await this.refuseIfRegistered(listingId, common.buyerEmail);
    return retryTransaction(
      async (): Promise<CreateOrderResultDto> => {
        const order = await this.prisma.$transaction(async (tx) => {
          const seq = await registerFree(tx, listingId, quantities);
          const locked = await lockedOrderLines(tx, listingId, dto);
          const order = await tx.order.create({
            data: {
              ...common,
              onePerEmail: locked.onePerEmail,
              items: { create: locked.lines },
              publicCode: publicCode(),
              isFree: true,
              status: 'CONFIRMED',
              sequenceNo: seq,
              subtotalCents: 0,
              platformFeeCents: 0,
              totalCents: 0,
            },
            include: orderDetail,
          });
          await this.notifications.enqueue(tx, this.confirmation(order, `REGISTRATION_CONFIRMED:${order.id}`));
          return order;
        });
        return { kind: 'confirmed', publicCode: order.publicCode, accessToken: order.accessToken };
      },
      async () => {
        const raced = await this.replay(common.idempotencyKey);
        if (raced) return raced;
        // A concurrent registration with the same email won (order_one_per_email_live_key).
        if (onePerEmail) await this.refuseIfRegistered(listingId, common.buyerEmail);
        return null;
      },
    );
  }

  private async refuseIfRegistered(listingId: string, email: string): Promise<void> {
    // The same rows order_one_per_email_live_key guards (the index is the race backstop), found through that index.
    const [registered] = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "order"
      WHERE listing_id = ${listingId}::uuid AND one_per_email AND lower(buyer_email) = lower(${email})
        AND status IN ('CONFIRMED', 'FULFILLED')
      LIMIT 1`;
    if (!registered) return;
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: registered.id }, include: orderDetail });
    // At most one re-send per hour, however often someone tries this email.
    await this.notifications.enqueue(this.prisma, this.confirmation(order, `REGISTRATION_CONFIRMED:${order.id}:resend:${utcHour(new Date()).key}`));
    throw new AppError('ALREADY_REGISTERED', 'This email is already registered');
  }

  private confirmation(order: OrderDetail, dedupeKey: string) {
    return {
      type: 'REGISTRATION_CONFIRMED' as const,
      recipient: order.buyerEmail,
      locale: order.locale,
      payload: {
        ...confirmationBase(this.env, order, order.sequenceNo!),
        items: order.items.map((i) => ({ name: i.option.name, quantity: i.quantity })),
        selfCancelUntil: selfCancelDeadline(order)?.toISOString() ?? null,
        canSelfCancel: order.listing.allowSelfCancel,
      },
      dedupeKey,
    };
  }

  /** The first answer for an Idempotency-Key, or null when the key is new (§7.2). */
  private async replay(key: string): Promise<CreateOrderResultDto | null> {
    const order = await this.prisma.order.findUnique({ where: { idempotencyKey: key }, include: orderDetail });
    if (!order) return null;
    // An anonymized buyer's order is no one's to open again: its new token is never handed out (DESIGN §9).
    if (order.anonymizedAt) throw new AppError('NOT_FOUND', 'Order not found');
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
    assertOrderToken(order, token);
    return toPublicOrder(order);
  }

  /** Turnstile (DESIGN §10): every new order and every find-my-orders request is human-verified first. */
  private async assertHuman(token: string, remoteIp?: string): Promise<void> {
    if (!(await this.turnstile.verify(token, remoteIp))) throw new AppError('TURNSTILE_FAILED', 'Verification failed');
  }

  /**
   * POST /public/orders/recover (DESIGN §9): queues the request for recovery.job and answers. Every human-checked
   * request does exactly this, whether or not the address has orders, so neither the answer nor its timing reveals
   * anything; the lookup and the per-address limit happen in the job.
   */
  async recover(dto: RecoverOrdersDto, remoteIp?: string): Promise<RecoverOrdersResultDto> {
    await this.assertHuman(dto.turnstileToken, remoteIp);
    await this.prisma.orderRecoveryRequest.create({ data: { email: normalizeEmail(dto.email), locale: dto.locale ?? DEFAULT_LOCALE } });
    return { ok: true };
  }

  /** GET /public/orders/:publicCode/calendar.ics (X-Order-Token) — the .ics of a confirmed event or lesson order. */
  async calendar(code: string, token: string): Promise<string> {
    const order = await this.prisma.order.findUnique({ where: { publicCode: code }, include: orderDetail });
    assertOrderToken(order, token);
    if (!hasCalendar(order)) throw new AppError('NOT_FOUND', 'Order not found');
    return icsCalendar(calendarEvents(this.env, order));
  }

  /**
   * POST /public/orders/:publicCode/cancel (X-Order-Token): a paid order while unpaid, or a free registration within
   * its self-cancel window (DESIGN §9), which gives its places back.
   */
  async cancel(code: string, token: string): Promise<PublicOrderDto> {
    const order = await this.prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, { publicCode: code });
      assertOrderToken(order, token);
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
    hasCalendar: hasCalendar(order),
  };
}

/**
 * Runs a write transaction, again on a deadlock or serialization failure. A unique violation (the same key or email won
 * a concurrent race, or a public-code collision) asks `onConflict` for the answer, and runs again when it has none.
 */
async function retryTransaction<T, R>(run: () => Promise<T>, onConflict: () => Promise<R | null>): Promise<T | R> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (isRetryableTransactionError(e) && attempt < ATTEMPTS) continue;
      if (!isUniqueViolation(e)) throw e;
      const answer = await onConflict();
      if (answer) return answer;
      if (attempt >= ATTEMPTS) throw e;
    }
  }
}

/** A wrong token looks exactly like no order. */
function assertOrderToken<T extends { accessToken: string }>(order: T | null, token: string): asserts order is T {
  if (!order || !tokenMatches(order.accessToken, token)) throw new AppError('NOT_FOUND', 'Order not found');
}

function tokenMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
