import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { OrderStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { type AuthUser, requireMerchantId } from '../auth/auth-user.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { StripeClient } from '../stripe/stripe-client.js';
import type { MerchantOrderDto, MerchantOrderListDto, MerchantOrdersQueryDto } from './merchant-order.dto.js';
import { canTransition, transitionOrder } from './order-state-machine.js';
import { readFormFields } from '../listings/form-fields.js';
import { ordersCsv } from './orders-csv.js';
import { confirmRefund, pendingByOrder, refundable, refundableCents } from './refunds.js';
import { eventStarted } from '../listings/availability.js';
import { cancelFreeWithEmail, lockOrder, type OrderDetail, orderDetail } from './order-ops.js';

// Orders a merchant sees: everything except unpaid checkouts that never completed.
const HIDDEN: OrderStatus[] = ['PENDING_PAYMENT', 'EXPIRED'];

const merchantDetail = {
  ...orderDetail,
  items: { select: { ...orderDetail.items.select, attendeeAnswers: true, option: { select: { name: true, startsAt: true } } } },
  listing: { select: { ...orderDetail.listing.select, closesAt: true } },
} satisfies Prisma.OrderInclude;
type MerchantDetail = Prisma.OrderGetPayload<{ include: typeof merchantDetail }>;

@Injectable()
export class MerchantOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly stripe: StripeClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get deps() {
    return { notifications: this.notifications, env: this.env };
  }

  /** GET /merchants/me/listings/:id/orders (DESIGN §9): newest sign-up first; M6 adds CSV and refunds. */
  async list(user: AuthUser, listingId: string, query: MerchantOrdersQueryDto): Promise<MerchantOrderListDto> {
    const merchantId = requireMerchantId(user);
    const listing = await this.prisma.listing.findFirst({
      where: { id: listingId, merchantId },
      select: { id: true, title: true, pricing: true, status: true },
    });
    if (!listing) throw new AppError('NOT_FOUND', 'Listing not found');
    const q = query.q?.trim();
    const orders = await this.prisma.order.findMany({
      where: {
        listingId,
        status: query.status ?? { notIn: HIDDEN },
        ...(q && {
          OR: [
            { buyerName: { contains: q, mode: 'insensitive' } },
            { buyerEmail: { contains: q, mode: 'insensitive' } },
            { buyerPhone: { contains: q } },
            { publicCode: { contains: q, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: [{ sequenceNo: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      include: merchantDetail,
    });
    const pending = await pendingByOrder(this.prisma, orders.map((o) => o.id));
    return { listing, orders: orders.map((o) => toMerchantOrder(o, pending.get(o.id) ?? 0)) };
  }

  /** Check-in (free) or hand-over (paid): DESIGN §6 → FULFILLED. */
  fulfil(user: AuthUser, orderId: string): Promise<MerchantOrderDto> {
    return this.change(user, orderId, async (tx, order) => {
      await transitionOrder(tx, order, 'FULFILLED', { fulfilledAt: new Date() });
    });
  }

  /** A free registration cancelled by the merchant: places freed, buyer told why (DESIGN §9). Paid orders refund (M6). */
  cancel(user: AuthUser, orderId: string, reason: string): Promise<MerchantOrderDto> {
    return this.change(user, orderId, async (tx, order) => {
      if (!order.isFree) throw new AppError('INVALID_STATE_TRANSITION', 'Paid orders are refunded, not cancelled', { from: order.status, to: 'CANCELLED' });
      await cancelFreeWithEmail(tx, this.deps, order, reason);
    });
  }

  /** A free registrant who did not come (DESIGN §6): only once the event has started; places are not released. */
  noShow(user: AuthUser, orderId: string): Promise<MerchantOrderDto> {
    return this.change(user, orderId, async (tx, order) => {
      const detail = await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: merchantDetail });
      if (!started(detail, new Date())) {
        throw new AppError('INVALID_STATE_TRANSITION', 'The event has not started yet', { from: order.status, to: 'NO_SHOW' });
      }
      await transitionOrder(tx, order, 'NO_SHOW');
    });
  }

  /**
   * A merchant refund (DESIGN §8.4), full or partial. Decided under the order lock (a PENDING Refund row, so two refunds
   * cannot exceed the total), sent to Stripe with the row id as idempotency key, then settled. A Stripe error leaves
   * the row FAILED and nothing refunded.
   */
  async refund(user: AuthUser, orderId: string, amountCents: number, reason: string): Promise<MerchantOrderDto> {
    const merchantId = requireMerchantId(user);
    const decided = await this.prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, { id: orderId });
      if (!order || order.merchantId !== merchantId) throw new AppError('NOT_FOUND', 'Order not found');
      if (order.isFree || !REFUNDABLE.includes(order.status) || !order.stripePaymentIntentId) {
        throw new AppError('INVALID_STATE_TRANSITION', 'Only paid orders can be refunded', { from: order.status, to: 'REFUNDED' });
      }
      const left = await refundableCents(tx, order);
      if (amountCents > left) throw new AppError('REFUND_EXCEEDS_TOTAL', 'More than is left to refund', { refundableCents: left });
      const refund = await tx.refund.create({ data: { orderId, amountCents, reason, status: 'PENDING' } });
      return { refund, accountId: order.merchant.stripeAccountId!, paymentIntentId: order.stripePaymentIntentId };
    });
    let stripeRefund: { id: string; status: string };
    try {
      stripeRefund = await this.stripe.refundPayment(decided.accountId, decided.paymentIntentId, amountCents, `refund:${decided.refund.id}`);
    } catch (e) {
      await this.prisma.refund.update({ where: { id: decided.refund.id }, data: { status: 'FAILED' } });
      throw e;
    }
    await this.prisma.$transaction(async (tx) => {
      await confirmRefund(tx, this.deps, (await lockOrder(tx, { id: orderId }))!, decided.refund, stripeRefund.id);
    });
    return this.read(orderId);
  }

  /** GET /merchants/me/listings/:id/orders.csv — every order with its answers, for spreadsheets. */
  async csv(user: AuthUser, listingId: string): Promise<{ filename: string; body: string }> {
    const { listing, orders } = await this.list(user, listingId, {});
    const fields = readFormFields((await this.prisma.listing.findUniqueOrThrow({ where: { id: listingId }, select: { formFields: true } })).formFields);
    return { filename: `orders-${listing.id.slice(0, 8)}.csv`, body: ordersCsv(fields, orders) };
  }

  private async read(orderId: string): Promise<MerchantOrderDto> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: merchantDetail });
    return toMerchantOrder(order, (await pendingByOrder(this.prisma, [orderId])).get(orderId) ?? 0);
  }

  /** Locks the merchant's own order, applies the change, and returns the updated order. Another merchant's is 404. */
  private async change(
    user: AuthUser,
    orderId: string,
    apply: (tx: Prisma.TransactionClient, order: OrderDetail) => Promise<void>,
  ): Promise<MerchantOrderDto> {
    const merchantId = requireMerchantId(user);
    await this.prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, { id: orderId });
      if (!order || order.merchantId !== merchantId) throw new AppError('NOT_FOUND', 'Order not found');
      await apply(tx, order);
    });
    return this.read(orderId);
  }
}

const started = (o: MerchantDetail, now: Date) => eventStarted(o.items.map((i) => i.option.startsAt), o.listing.closesAt, now);

const REFUNDABLE: OrderStatus[] = ['PAID', 'PARTIALLY_REFUNDED', 'FULFILLED'];

function toMerchantOrder(o: MerchantDetail, pendingRefundCents: number, now = new Date()): MerchantOrderDto {
  const confirmed = o.isFree && o.status === 'CONFIRMED';
  return {
    id: o.id,
    publicCode: o.publicCode,
    sequenceNo: o.sequenceNo,
    status: o.status,
    isFree: o.isFree,
    buyerName: o.buyerName,
    buyerEmail: o.buyerEmail,
    buyerPhone: o.buyerPhone,
    buyerNote: o.buyerNote,
    displayAnonymous: o.displayAnonymous,
    formAnswers: o.formAnswers as Record<string, unknown>,
    items: o.items.map((i) => ({
      name: i.option.name,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      attendeeAnswers: (i.attendeeAnswers ?? []) as Record<string, unknown>[],
    })),
    totalCents: o.totalCents,
    refundedCents: o.refundedCents,
    pickupPointLabel: o.pickupPoint?.label ?? null,
    createdAt: o.createdAt,
    paidAt: o.paidAt,
    fulfilledAt: o.fulfilledAt,
    cancelledAt: o.cancelledAt,
    canFulfil: canTransition(o.isFree, o.status, 'FULFILLED'),
    canCancel: confirmed,
    canNoShow: confirmed && started(o, now),
    refundableCents: !o.isFree && REFUNDABLE.includes(o.status) ? refundable(o, pendingRefundCents) : 0,
  };
}
