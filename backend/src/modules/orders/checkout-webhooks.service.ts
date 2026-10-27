import { Inject, Injectable, Logger } from '@nestjs/common';
import type Stripe from 'stripe';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { OrderAutoRefundedPayload, OrderConfirmedPayload } from '../notifications/templates.js';
import { StripeClient } from '../stripe/stripe-client.js';
import { transitionOrder } from './order-state-machine.js';
import { endUnpaid, lockOrder, type OrderDetail } from './order-ops.js';
import { sell, sellAfresh } from './reservation.js';
import { listingUrl, orderUrl } from './urls.js';

// DESIGN §8.3 / §7.5. Every handler is idempotent and tolerates events in any order: the order row is locked,
// and only the transition that still applies is made.
@Injectable()
export class CheckoutWebhooksService {
  private readonly logger = new Logger(CheckoutWebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeClient,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async completed(session: Stripe.Checkout.Session): Promise<void> {
    if (session.payment_status !== 'paid') return; // card payments are paid on completion; nothing else is offered
    const orderId = session.metadata?.orderId;
    const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!orderId || !paymentIntentId) {
      this.logger.warn(`checkout.session.completed ${session.id} without orderId / payment_intent`);
      return;
    }
    const paid = { sessionId: session.id, paymentIntentId };
    // The order to refund, when a payment arrived for places that are gone.
    const toRefund = await this.prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, { id: orderId });
      if (!order) {
        this.logger.warn(`checkout.session.completed for unknown order ${orderId}`);
        return null;
      }
      if (order.status === 'PENDING_PAYMENT') {
        await this.markPaid(tx, order, paid, await sell(tx, order.listingId, order.items));
        return null;
      }
      // Already paid (a replay), or a late payment that was refunded already.
      if ((order.status !== 'EXPIRED' && order.status !== 'CANCELLED') || order.refundedCents > 0) return null;
      // §7.5: paid just after the reservation ended. Take the places again if they are still there.
      const seq = order.status === 'EXPIRED' ? await sellAfresh(tx, order.listingId, order.items) : null;
      if (seq !== null) {
        await this.markPaid(tx, order, paid, seq);
        return null;
      }
      await tx.order.update({ where: { id: order.id }, data: { stripePaymentIntentId: paymentIntentId } });
      return order;
    });
    if (toRefund) await this.refundLatePayment(toRefund, paymentIntentId);
  }

  async expired(session: Stripe.Checkout.Session): Promise<void> {
    const orderId = session.metadata?.orderId;
    if (!orderId) return;
    await this.prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, { id: orderId });
      // Anything but an unpaid order means the expiry job, a cancel or the payment got there first.
      if (order?.status === 'PENDING_PAYMENT') await endUnpaid(tx, order, 'EXPIRED');
    });
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
      const { count } = await tx.refund.createMany({
        data: [
          {
            orderId: order.id,
            amountCents: order.totalCents,
            reason: 'Paid after the reservation expired; sold out',
            stripeRefundId: refund.id,
            status: refund.status === 'succeeded' ? 'SUCCEEDED' : 'PENDING',
          },
        ],
        skipDuplicates: true,
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
