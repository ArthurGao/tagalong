import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DEFAULT_LOCALE } from '../../common/locale.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { CancellationFinishedPayload } from '../notifications/templates.js';
import { StripeClient } from '../stripe/stripe-client.js';
import { lockOrder } from './order-ops.js';
import { confirmRefund } from './refunds.js';

const BATCH = 20;
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 30_000;
const LEASE_MS = 5 * 60_000; // longer than a batch of Stripe calls takes

interface ClaimedTask {
  id: string;
  order_id: string;
  amount_cents: number;
  attempts: number;
  cancellation_id: string;
}

/** When a failed refund is tried again: 1, 2, 4, 8 minutes after attempts 1–4 (30 s × 2^attempts). */
export function refundRetryAt(attempts: number, now: Date): Date {
  return new Date(now.getTime() + BASE_DELAY_MS * 2 ** attempts);
}

// DESIGN §8.5: refunds for a cancelled listing, 20 at a time every 30 s, SKIP LOCKED so instances never share a task.
// RefundTask.id is the Stripe idempotency key (and the Refund row's id), so a retry can never refund twice.
@Injectable()
export class RefundJob {
  private readonly logger = new Logger(RefundJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeClient,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'refund' })
  async run(now = new Date()): Promise<{ succeeded: number; retrying: number; failed: number }> {
    // Claim a batch by pushing its next attempt out (a lease), then call Stripe outside any transaction.
    const tasks = await this.prisma.$queryRaw<ClaimedTask[]>`
      UPDATE refund_task SET next_attempt_at = ${new Date(now.getTime() + LEASE_MS)}, updated_at = now()
      WHERE id IN (
        SELECT id FROM refund_task WHERE status = 'PENDING' AND next_attempt_at <= ${now}
        ORDER BY next_attempt_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED
      )
      RETURNING id, order_id, amount_cents, attempts, cancellation_id`;
    const result = { succeeded: 0, retrying: 0, failed: 0 };
    for (const task of tasks) {
      const order = await this.prisma.order.findUniqueOrThrow({
        where: { id: task.order_id },
        select: { stripePaymentIntentId: true, merchant: { select: { stripeAccountId: true } } },
      });
      try {
        const refund = await this.stripe.refundPayment(order.merchant.stripeAccountId!, order.stripePaymentIntentId!, task.amount_cents, task.id);
        await this.settle(task, refund.id);
        result.succeeded++;
      } catch (e) {
        result[(await this.recordFailure(task, e, now)) ? 'failed' : 'retrying']++;
      }
    }
    await this.finishCancellations(tasks.map((t) => t.cancellation_id));
    if (tasks.length) this.logger.log(`refund: ${result.succeeded} refunded, ${result.retrying} retrying, ${result.failed} failed`);
    return result;
  }

  /** Stripe accepted the refund: the task, its cancellation's count and the order's money move together. */
  private async settle(task: ClaimedTask, stripeRefundId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const order = (await lockOrder(tx, { id: task.order_id }))!;
      const { count } = await tx.refundTask.updateMany({ where: { id: task.id, status: 'PENDING' }, data: { status: 'SUCCEEDED', stripeRefundId } });
      if (!count) return;
      const { reason } = await tx.listingCancellation.update({ where: { id: task.cancellation_id }, data: { succeeded: { increment: 1 } } });
      await confirmRefund(tx, { notifications: this.notifications, env: this.env }, order, { id: task.id, amountCents: task.amount_cents, reason }, stripeRefundId);
    });
  }

  /** A failed attempt: retried later, or FAILED (with its Refund row) after the last one. Returns whether it gave up. */
  private async recordFailure(task: ClaimedTask, e: unknown, now: Date): Promise<boolean> {
    const attempts = task.attempts + 1;
    const lastError = e instanceof Error ? e.message.slice(0, 500) : String(e);
    const giveUp = attempts >= MAX_ATTEMPTS;
    await this.prisma.$transaction(async (tx) => {
      await tx.refundTask.update({
        where: { id: task.id },
        data: giveUp ? { attempts, lastError, status: 'FAILED' } : { attempts, lastError, nextAttemptAt: refundRetryAt(attempts, now) },
      });
      if (giveUp) {
        await tx.refund.update({ where: { id: task.id }, data: { status: 'FAILED' } });
        await tx.listingCancellation.update({ where: { id: task.cancellation_id }, data: { failed: { increment: 1 } } });
      }
    });
    if (giveUp) this.logger.error(`refund: task ${task.id} FAILED after ${attempts} attempts: ${lastError}`);
    return giveUp;
  }

  /** A cancellation with nothing left pending is done; the merchant hears how it went. */
  private async finishCancellations(ids: string[]): Promise<void> {
    for (const id of new Set(ids)) {
      await this.prisma.$transaction(async (tx) => {
        if (await tx.refundTask.count({ where: { cancellationId: id, status: 'PENDING' } })) return;
        const c = await tx.listingCancellation.findUniqueOrThrow({
          where: { id },
          include: { listing: { select: { title: true, merchant: { select: { contactEmail: true } } } } },
        });
        if (c.status !== 'RUNNING') return;
        await tx.listingCancellation.update({
          where: { id },
          data: { status: c.failed ? 'COMPLETED_WITH_FAILURES' : 'COMPLETED', finishedAt: new Date() },
        });
        await this.notifications.enqueue(tx, {
          type: 'CANCELLATION_FINISHED',
          recipient: c.listing.merchant.contactEmail,
          locale: DEFAULT_LOCALE, // merchants have no language setting yet
          payload: { listingTitle: c.listing.title, succeeded: c.succeeded, failed: c.failed } satisfies CancellationFinishedPayload,
          dedupeKey: `CANCELLATION_FINISHED:${id}:${c.succeeded}:${c.failed}`,
        });
      });
    }
  }
}
