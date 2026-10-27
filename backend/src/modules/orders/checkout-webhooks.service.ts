import { Inject, Injectable, Logger } from '@nestjs/common';
import type Stripe from 'stripe';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { MerchantDisputePayload, OrderAutoRefundedPayload, OrderConfirmedPayload } from '../notifications/templates.js';
import { DEFAULT_LOCALE } from '../../common/locale.js';
import { pendingByOrder, settleRefund } from './refunds.js';
import { StripeClient } from '../stripe/stripe-client.js';
import { transitionOrder } from './order-state-machine.js';
import { endUnpaid, lockOrder, type OrderDetail, orderDetail, recoverCheckoutSession } from './order-ops.js';
import { sell, sellAfresh } from './reservation.js';
import { listingUrl, orderUrl } from './urls.js';

// DESIGN §8.3 / §7.5. Every handler is idempotent and tolerates events in any order: the order row is locked,
// and only the transition that still applies is made.
//
// A valid signature proves Stripe sent the event, not that it pays for this order: any connected merchant could put
// another order's id in its own session's metadata. So an event only counts when it comes from the order's own
// connected account and the Checkout session the platform opened for it, for the order's amount in NZD.
function belongsTo(order: OrderDetail, session: Stripe.Checkout.Session, account: string | undefined): boolean {
  return Boolean(account) && account === order.merchant.stripeAccountId && session.id === order.stripeCheckoutSessionId;
}
@Injectable()
export class CheckoutWebhooksService {
  private readonly logger = new Logger(CheckoutWebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeClient,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get deps() {
    return { notifications: this.notifications, env: this.env };
  }

  async completed(session: Stripe.Checkout.Session, account: string | undefined): Promise<void> {
    // A delayed method completes the session unpaid; the order waits for async_payment_succeeded / _failed.
    if (session.payment_status !== 'paid') return;
    const orderId = session.metadata?.orderId;
    const paymentIntentId = paymentIntentIdOf(session);
    if (!orderId || !paymentIntentId) {
      this.logger.warn(`checkout.session.completed ${session.id} without orderId / payment_intent`);
      return;
    }
    await this.recoverUnsavedSession(orderId);
    const paid = { sessionId: session.id, paymentIntentId };
    // The order to refund, when a payment arrived for places that are gone.
    const toRefund = await this.prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, { id: orderId });
      if (!order) {
        this.logger.warn(`checkout.session.completed for unknown order ${orderId}`);
        return null;
      }
      if (!belongsTo(order, session, account) || session.amount_total !== order.totalCents || session.currency !== 'nzd') {
        this.logger.warn(`checkout.session.completed ${session.id} does not match order ${orderId}; ignored`);
        return null;
      }
      if (order.status === 'PENDING_PAYMENT') {
        await this.markPaid(tx, order, paid, await sell(tx, order.listingId, order.items));
        return null;
      }
      if (order.status !== 'EXPIRED' && order.status !== 'CANCELLED') return null; // already paid: a replay
      // A refund was decided earlier (under this lock): carry it out, never reconsider it, even if places freed up.
      const decided = await tx.refund.findFirst({ where: { orderId: order.id }, select: { stripeRefundId: true } });
      if (decided) return decided.stripeRefundId ? null : order;
      // §7.5: paid just after the reservation ended. Take the places again if they are still there.
      const seq = order.status === 'EXPIRED' ? await sellAfresh(tx, order.listingId, order.items) : null;
      if (seq !== null) {
        await this.markPaid(tx, order, paid, seq);
        return null;
      }
      // Decide the refund before calling Stripe (a PENDING row), so a concurrent or retried delivery can only resume it.
      await tx.order.update({ where: { id: order.id }, data: { stripePaymentIntentId: paymentIntentId } });
      await tx.refund.create({
        data: { orderId: order.id, amountCents: order.totalCents, reason: 'Paid after the reservation expired; sold out', status: 'PENDING' },
      });
      return order;
    });
    if (toRefund) await this.refundLatePayment(toRefund, paymentIntentId);
  }

  async expired(session: Stripe.Checkout.Session, account: string | undefined): Promise<void> {
    const orderId = session.metadata?.orderId;
    if (!orderId) return;
    await this.prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, { id: orderId });
      // Anything but an unpaid order means the expiry job, a cancel or the payment got there first.
      if (order?.status === 'PENDING_PAYMENT' && belongsTo(order, session, account)) await endUnpaid(tx, order, 'EXPIRED');
    });
  }

  /**
   * charge.refunded (DESIGN §8.3): a refund made outside TagAlong, e.g. by the merchant in the Stripe Dashboard. Only
   * the part we have not recorded (or have in flight) is added, so our own refunds are never counted twice.
   */
  async chargeRefunded(charge: Stripe.Charge, account: string | undefined): Promise<void> {
    const paymentIntentId = paymentIntentIdOf(charge);
    if (!paymentIntentId) return;
    await this.prisma.$transaction(async (tx) => {
      const found = await tx.order.findUnique({ where: { stripePaymentIntentId: paymentIntentId }, select: { id: true } });
      const order = found && (await lockOrder(tx, { id: found.id }));
      if (!order || !account || account !== order.merchant.stripeAccountId) {
        this.logger.warn(`charge.refunded ${charge.id} matches no order of account ${account}; ignored`);
        return;
      }
      const unrecorded = charge.amount_refunded - order.refundedCents - ((await pendingByOrder(tx, [order.id])).get(order.id) ?? 0);
      if (unrecorded <= 0) return;
      await tx.refund.create({ data: { orderId: order.id, amountCents: unrecorded, reason: 'Refunded in the Stripe Dashboard', status: 'SUCCEEDED' } });
      await settleRefund(tx, this.deps, order, unrecorded, `charge:${charge.id}:${charge.amount_refunded}`, null);
    });
  }

  /** charge.dispute.created (DESIGN §8.3): logged, and the merchant is told to respond in Stripe. */
  async disputeCreated(dispute: Stripe.Dispute, account: string | undefined): Promise<void> {
    const paymentIntentId = paymentIntentIdOf(dispute);
    const order = paymentIntentId
      ? await this.prisma.order.findUnique({
          where: { stripePaymentIntentId: paymentIntentId },
          include: { listing: { select: { title: true } }, merchant: { select: { stripeAccountId: true, contactEmail: true } } },
        })
      : null;
    if (!order || !account || account !== order.merchant.stripeAccountId) {
      this.logger.warn(`charge.dispute.created ${dispute.id} matches no order of account ${account}`);
      return;
    }
    this.logger.warn(`dispute ${dispute.id} on order ${order.id}: ${dispute.amount} cents, ${dispute.reason}`);
    await this.notifications.enqueue(this.prisma, {
      type: 'MERCHANT_DISPUTE',
      recipient: order.merchant.contactEmail,
      locale: DEFAULT_LOCALE, // merchants have no language setting yet
      payload: { publicCode: order.publicCode, listingTitle: order.listing.title, amountCents: dispute.amount, reason: dispute.reason } satisfies MerchantDisputePayload,
      dedupeKey: `MERCHANT_DISPUTE:${dispute.id}`,
    });
  }

  /**
   * The order's own session id when the request that opened it died before saving it, recovered from Stripe (never
   * taken from the event), so a payment that lands meanwhile still finds its order.
   */
  private async recoverUnsavedSession(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: orderDetail });
    if (order?.status !== 'PENDING_PAYMENT' || order.stripeCheckoutSessionId || !order.merchant.stripeAccountId) return;
    await recoverCheckoutSession(this.prisma, this.stripe, this.env, order);
  }

  /** → PAID with its sign-up number, and the confirmation queued in the same transaction. */
  private async markPaid(
    tx: Prisma.TransactionClient,
    order: OrderDetail,
    paid: { sessionId: string; paymentIntentId: string },
    seq: number,
  ): Promise<void> {
    await transitionOrder(tx, order, 'PAID', {
      paidAt: new Date(),
      sequenceNo: seq,
      stripeCheckoutSessionId: paid.sessionId,
      stripePaymentIntentId: paid.paymentIntentId,
    });
    await this.notifications.enqueue(tx, {
      type: 'ORDER_CONFIRMED',
      recipient: order.buyerEmail,
      locale: order.locale,
      payload: {
        publicCode: order.publicCode,
        listingTitle: order.listing.title,
        seq,
        items: order.items.map((i) => ({ name: i.option.name, quantity: i.quantity, unitPriceCents: i.unitPriceCents })),
        totalCents: order.totalCents,
        orderUrl: orderUrl(this.env, order.locale, order.publicCode, order.accessToken),
        pickup: order.pickupPoint && { label: order.pickupPoint.label, address: order.pickupPoint.address },
      } satisfies OrderConfirmedPayload,
      dedupeKey: `ORDER_CONFIRMED:${order.id}`,
    });
  }

  /**
   * §7.5: no places left for a payment that arrived after expiry. Full refund (fee included), recorded once;
   * the Stripe idempotency key makes a retried webhook safe, and the order stays EXPIRED.
   */
  private async refundLatePayment(order: OrderDetail, paymentIntentId: string): Promise<void> {
    const accountId = order.merchant.stripeAccountId;
    if (!accountId) throw new Error(`Order ${order.id} paid on a merchant without a Stripe account`);
    const refund = await this.stripe.refundPayment(accountId, paymentIntentId, order.totalCents, `late-refund:${order.id}`);
    await this.prisma.$transaction(async (tx) => {
      // First to record Stripe's answer wins; refundedCents moves only now that the money has moved.
      const { count } = await tx.refund.updateMany({
        where: { orderId: order.id, stripeRefundId: null },
        data: { stripeRefundId: refund.id, status: refund.status === 'succeeded' ? 'SUCCEEDED' : 'PENDING' },
      });
      if (count === 0) return;
      await tx.order.update({ where: { id: order.id }, data: { refundedCents: order.totalCents } });
      await this.notifications.enqueue(tx, {
        type: 'ORDER_AUTO_REFUNDED',
        recipient: order.buyerEmail,
        locale: order.locale,
        payload: {
          publicCode: order.publicCode,
          listingTitle: order.listing.title,
          totalCents: order.totalCents,
          listingUrl: listingUrl(this.env, order.locale, order.listing.shortCode),
        } satisfies OrderAutoRefundedPayload,
        dedupeKey: `ORDER_AUTO_REFUNDED:${order.id}`,
      });
    });
    this.logger.warn(`late payment on sold-out order ${order.id}: refunded ${order.totalCents} cents`);
  }
}

const paymentIntentIdOf = (o: { payment_intent: string | { id: string } | null }) =>
  typeof o.payment_intent === 'string' ? o.payment_intent : o.payment_intent?.id;
