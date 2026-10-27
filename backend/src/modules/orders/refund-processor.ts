import { Inject, Injectable, Logger } from '@nestjs/common';
import { errorText } from '../../common/errors/error-text.js';
import { DEFAULT_LOCALE } from '../../common/locale.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { RefundFailedPayload } from '../notifications/templates.js';
import { StripeClient, type StripeRefund } from '../stripe/stripe-client.js';
import { lockOrder } from './order-ops.js';
import { type ClaimedRefund, markRefundSucceeded } from './refunds.js';

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 30_000;
/** Stripe keeps an idempotency key for 24 h; a task older than this may have outlived its key. */
const KEY_SAFE_MS = 23 * 60 * 60_000;
/** How often a refund Stripe holds as pending (e.g. the merchant's balance is short) is looked at again. */
const PENDING_RECHECK_MS = 15 * 60_000;

/** When a failed refund is tried again: 1, 2, 4, 8 minutes after attempts 1–4 (30 s × 2^attempts). */
export function refundRetryAt(attempts: number, now: Date): Date {
  return new Date(now.getTime() + BASE_DELAY_MS * 2 ** attempts);
}

export type RefundOutcome = 'succeeded' | 'waiting' | 'retrying' | 'failed';

/**
 * Carries out one claimed refund task (DESIGN §8.4, §8.5), for refund.job and for the inline first try. Every write is
 * conditional on the task still being PENDING under this worker's lease, so a worker whose lease ran out changes
 * nothing; a success Stripe reports is recorded whatever the task's state (Stripe is the authority).
 */
@Injectable()
export class RefundProcessor {
  private readonly logger = new Logger(RefundProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeClient,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get deps() {
    return { notifications: this.notifications, env: this.env };
  }

  async process(task: ClaimedRefund, now = new Date()): Promise<RefundOutcome> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: task.orderId },
      select: { stripePaymentIntentId: true, merchant: { select: { stripeAccountId: true } } },
    });
    let refund: StripeRefund;
    try {
      refund = await this.askStripe(task, order.merchant.stripeAccountId!, order.stripePaymentIntentId!);
    } catch (e) {
      return this.recordFailure(task, errorText(e), now);
    }
    if (refund.status === 'succeeded') {
      await this.prisma.$transaction(async (tx) => {
        const locked = (await lockOrder(tx, { id: task.orderId }))!;
        await markRefundSucceeded(tx, this.deps, locked, task.id, refund.id);
      });
      return 'succeeded';
    }
    if (refund.status === 'failed' || refund.status === 'canceled') {
      return this.giveUp(task, task.attempts, `Stripe refund ${refund.status}`, refund.id);
    }
    // pending / requires_action: Stripe has it; look again later, without counting an attempt.
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.refundTask.updateMany({
        where: { id: task.id, status: 'PENDING', leaseToken: task.leaseToken },
        data: { stripeRefundId: refund.id, nextAttemptAt: new Date(now.getTime() + PENDING_RECHECK_MS), leaseToken: null },
      });
      if (count) await tx.refund.update({ where: { id: task.id }, data: { stripeRefundId: refund.id } });
    });
    return 'waiting';
  }

  /**
   * Stripe's refund for this task. Once known, it is read back. Before that, an earlier attempt may have reached Stripe
   * without us hearing the answer: within 24 h the same idempotency key replays it, and an older task first looks the
   * refund up by its metadata, so a key that expired can never refund twice.
   */
  private async askStripe(task: ClaimedRefund, accountId: string, paymentIntentId: string): Promise<StripeRefund> {
    if (task.stripeRefundId) return this.stripe.retrieveRefund(accountId, task.stripeRefundId);
    if (Date.now() - task.createdAt.getTime() > KEY_SAFE_MS) {
      const earlier = (await this.stripe.listRefunds(accountId, paymentIntentId)).find((r) => r.refundId === task.id);
      if (earlier) return earlier;
    }
    return this.stripe.refundPayment(accountId, paymentIntentId, task.amountCents, task.id);
  }

  /** No answer from Stripe: try again after a backoff, or give up after the last attempt. */
  private async recordFailure(task: ClaimedRefund, lastError: string, now: Date): Promise<RefundOutcome> {
    const attempts = task.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) return this.giveUp(task, attempts, lastError, null);
    await this.prisma.refundTask.updateMany({
      where: { id: task.id, status: 'PENDING', leaseToken: task.leaseToken },
      data: { attempts, lastError, nextAttemptAt: refundRetryAt(attempts, now), leaseToken: null },
    });
    return 'retrying';
  }

  /**
   * FAILED: the task, its Refund row (the amount is refundable again) and the cancellation's count; a single refund's
   * merchant is emailed. A worker that no longer holds the task changes nothing (and reports 'retrying').
   */
  private async giveUp(task: ClaimedRefund, attempts: number, lastError: string, stripeRefundId: string | null): Promise<RefundOutcome> {
    const done = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.refundTask.updateMany({
        where: { id: task.id, status: 'PENDING', leaseToken: task.leaseToken },
        data: { status: 'FAILED', attempts, lastError, leaseToken: null, ...(stripeRefundId && { stripeRefundId }) },
      });
      if (!count) return false;
      await tx.refund.update({ where: { id: task.id }, data: { status: 'FAILED', ...(stripeRefundId && { stripeRefundId }) } });
      if (task.cancellationId) {
        await tx.listingCancellation.update({ where: { id: task.cancellationId }, data: { failed: { increment: 1 } } });
        return true;
      }
      const order = await tx.order.findUniqueOrThrow({
        where: { id: task.orderId },
        select: { publicCode: true, listing: { select: { title: true } }, merchant: { select: { contactEmail: true } } },
      });
      await this.notifications.enqueue(tx, {
        type: 'REFUND_FAILED',
        recipient: order.merchant.contactEmail,
        locale: DEFAULT_LOCALE, // merchants have no language setting yet
        payload: { publicCode: order.publicCode, listingTitle: order.listing.title, amountCents: task.amountCents, error: lastError } satisfies RefundFailedPayload,
        dedupeKey: `REFUND_FAILED:${task.id}`,
      });
      return true;
    });
    if (!done) return 'retrying';
    this.logger.error(`refund: task ${task.id} FAILED after ${attempts} attempts: ${lastError}`);
    return 'failed';
  }
}
