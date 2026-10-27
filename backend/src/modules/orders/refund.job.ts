import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DEFAULT_LOCALE } from '../../common/locale.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { CancellationFinishedPayload } from '../notifications/templates.js';
import { type RefundOutcome, RefundProcessor } from './refund-processor.js';
import { type ClaimedRefund, LEASE_MS } from './refunds.js';

const BATCH = 20;

// DESIGN §8.4 / §8.5: every queued refund (a listing cancellation's, or a single one whose first try did not finish),
// 20 at a time every 30 s. A claim is a lease with this run's token, so instances never share a task and a run that
// outlives its lease writes nothing. RefundTask.id is the Refund row's id and Stripe's idempotency key.
@Injectable()
export class RefundJob {
  private readonly logger = new Logger(RefundJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: RefundProcessor,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'refund' })
  async run(now = new Date()): Promise<Record<RefundOutcome, number>> {
    const leaseToken = randomUUID();
    const tasks = await this.prisma.$queryRaw<Omit<ClaimedRefund, 'leaseToken'>[]>`
      UPDATE refund_task SET next_attempt_at = ${new Date(now.getTime() + LEASE_MS)}, lease_token = ${leaseToken}::uuid, updated_at = now()
      WHERE id IN (
        SELECT id FROM refund_task WHERE status = 'PENDING' AND next_attempt_at <= ${now}
        ORDER BY next_attempt_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED
      )
      RETURNING id, order_id AS "orderId", amount_cents AS "amountCents", attempts,
        cancellation_id AS "cancellationId", stripe_refund_id AS "stripeRefundId", created_at AS "createdAt"`;
    const result: Record<RefundOutcome, number> = { succeeded: 0, waiting: 0, retrying: 0, failed: 0 };
    for (const task of tasks) result[await this.processor.process({ ...task, leaseToken }, now)]++;
    await this.finishCancellations();
    if (tasks.length) {
      this.logger.log(`refund: ${result.succeeded} refunded, ${result.waiting} pending at Stripe, ${result.retrying} retrying, ${result.failed} failed`);
    }
    return result;
  }

  /**
   * Every running cancellation with nothing left pending is done, whichever run settled its last task (a run that died
   * just after it leaves the cancellation for the next one); the merchant hears how it went.
   */
  private async finishCancellations(): Promise<void> {
    const done = await this.prisma.listingCancellation.findMany({
      where: { status: 'RUNNING', tasks: { none: { status: 'PENDING' } } },
      select: { id: true },
    });
    for (const { id } of done) {
      await this.prisma.$transaction(async (tx) => {
        const c = await tx.listingCancellation.findUniqueOrThrow({
          where: { id },
          include: { listing: { select: { title: true, merchant: { select: { contactEmail: true } } } } },
        });
        // Conditional, so two instances finishing the same cancellation email once.
        const { count } = await tx.listingCancellation.updateMany({
          where: { id, status: 'RUNNING', tasks: { none: { status: 'PENDING' } } },
          data: { status: c.failed ? 'COMPLETED_WITH_FAILURES' : 'COMPLETED', finishedAt: new Date() },
        });
        if (!count) return;
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
