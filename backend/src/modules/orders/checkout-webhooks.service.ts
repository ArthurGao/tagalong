import { Inject, Injectable, Logger } from '@nestjs/common';
import type Stripe from 'stripe';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { MerchantDisputePayload, OrderConfirmedPayload } from '../notifications/templates.js';
import { DEFAULT_LOCALE } from '../../common/locale.js';
import { RefundProcessor } from './refund-processor.js';
import { type ClaimedRefund, markRefundSucceeded, queueRefund, settleRefund } from './refunds.js';
import { StripeClient } from '../stripe/stripe-client.js';
import { transitionOrder } from './order-state-machine.js';
import { endUnpaid, lockOrder, type OrderDetail, orderDetail, recoverCheckoutSession } from './order-ops.js';
import { sell, sellAfresh } from './reservation.js';
import { orderUrl } from './urls.js';

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
    private readonly refunds: RefundProcessor,
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
    // The refund to try, when a payment arrived for places that are gone.
    const toRefund = await this.prisma.$transaction(async (tx): Promise<ClaimedRefund | null> => {
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
      // A refund was decided earlier (under this lock): the refund queue carries it out; never reconsider it.
      if (await tx.refund.findFirst({ where: { orderId: order.id }, select: { id: true } })) return null;
      // §7.5: paid just after the reservation ended. Take the places again if they are still there (never on a
      // cancelled listing: sellAfresh refuses it like a sold-out one).
      const seq = order.status === 'EXPIRED' ? await sellAfresh(tx, order.listingId, order.items) : null;
      if (seq !== null) {
        await this.markPaid(tx, order, paid, seq);
        return null;
      }
      // Full refund (fee included), decided before Stripe is called; the order stays EXPIRED / CANCELLED.
      await tx.order.update({ where: { id: order.id }, data: { stripePaymentIntentId: paymentIntentId } });
      this.logger.warn(`late payment on order ${order.id} with no places (or a cancelled listing): refunding ${order.totalCents} cents`);
      return queueRefund(tx, { orderId: order.id, amountCents: order.totalCents, reason: 'Paid after the reservation ended; no places left' });
    });
    if (toRefund) await this.refunds.process(toRefund);
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
   * charge.refunded (DESIGN §8.3 / §8.4): Stripe's refunds of this payment are matched to our rows by refund id. One
   * of ours (metadata.refundId) that succeeded is confirmed if we have not yet heard; one made outside TagAlong (the
   * merchant's Stripe Dashboard) is recorded once by its id. So nothing is counted twice or lost, whatever the order.
   */
  async chargeRefunded(charge: Stripe.Charge, account: string | undefined): Promise<void> {
    const paymentIntentId = paymentIntentIdOf(charge);
    if (!paymentIntentId) return;
    const found = await this.prisma.order.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      select: { id: true, refundedCents: true, merchant: { select: { stripeAccountId: true } } },
    });
    if (!found || !account || account !== found.merchant.stripeAccountId) {
      this.logger.warn(`charge.refunded ${charge.id} matches no order of account ${account}; ignored`);
      return;
    }
    if (charge.amount_refunded === found.refundedCents) return; // every refund already recorded (e.g. our own echoed)
    const refunds = (await this.stripe.listRefunds(account, paymentIntentId)).filter((r) => r.status === 'succeeded');
    await this.prisma.$transaction(async (tx) => {
      let order = (await lockOrder(tx, { id: found.id }))!;
      const recorded = new Set((await tx.refund.findMany({ where: { orderId: order.id, status: 'SUCCEEDED' }, select: { id: true } })).map((r) => r.id));
      const known = new Set((await tx.refund.findMany({ where: { orderId: order.id, stripeRefundId: { not: null } }, select: { stripeRefundId: true } })).map((r) => r.stripeRefundId));
      for (const r of refunds) {
        if (r.refundId ? recorded.has(r.refundId) : known.has(r.id)) continue;
        if (r.refundId) {
          if (!(await markRefundSucceeded(tx, this.deps, order, r.refundId, r.id))) continue;
        } else {
          const row = await tx.refund.create({
            data: { orderId: order.id, amountCents: r.amountCents, reason: 'Refunded in the Stripe Dashboard', status: 'SUCCEEDED', stripeRefundId: r.id },
          });
          await settleRefund(tx, this.deps, order, r.amountCents, row.id, null);
        }
        order = (await lockOrder(tx, { id: order.id }))!; // settled: refundedCents and status moved
      }
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
}

const paymentIntentIdOf = (o: { payment_intent: string | { id: string } | null }) =>
  typeof o.payment_intent === 'string' ? o.payment_intent : o.payment_intent?.id;
