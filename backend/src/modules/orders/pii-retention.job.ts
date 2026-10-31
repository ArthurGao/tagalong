import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { eraseOutbox } from '../notifications/outbox-erase.js';
import { anonymizeOrders, lockBuyerEmails } from './anonymize.js';

const BATCH = 200;
const RETENTION_MONTHS = 12;

/** `now` less 12 calendar months (UTC); a day the earlier month lacks (29 February) becomes its last day. */
export function retentionCutoff(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);
  if (cutoff.getUTCDate() !== now.getUTCDate()) cutoff.setUTCDate(0); // rolled into the next month: step back
  return cutoff;
}

/** The order's listing (alias `l`) is over and ended before `cutoff`: CLOSED or CANCELLED, and its close, cancellation,
 * closing time and sessions all earlier. */
const endedBefore = (cutoff: Date) => Prisma.sql`l.status IN ('CLOSED', 'CANCELLED')
  AND GREATEST(l.closed_at, l.cancelled_at, l.closes_at,
        (SELECT max(GREATEST(lo.starts_at, lo.ends_at)) FROM listing_option lo WHERE lo.listing_id = l.id)) < ${cutoff}`;

/** An order no longer in motion: not awaiting payment, no open dispute, no refund in flight (alias `o`). */
const settled = Prisma.sql`o.status <> 'PENDING_PAYMENT'
  AND NOT EXISTS (SELECT 1 FROM dispute d WHERE d.order_id = o.id AND d.open)
  AND NOT EXISTS (SELECT 1 FROM refund_task t WHERE t.order_id = o.id AND t.status = 'PENDING')`;

// DESIGN §10 data retention: a buyer's PII is anonymised 12 months after the listing ended (amounts and status kept,
// as a privacy request does). A listing has ended once CLOSED or CANCELLED; it ended at the latest of when it closed
// or was cancelled, its closing time and its sessions. Not its last change: stock moving on a late refund touches it.
// Orders still in motion wait for a later day: awaiting payment, under an open dispute, or with a refund in flight.
// Every batch locks the buyers' addresses first (sorted), then the orders (SKIP LOCKED): the same order as a privacy
// request, so the two never deadlock, and find-my-orders never mails links being erased. Emails older than the period
// lose their recipient and content too, by age: the address may still have newer orders.
@Injectable()
export class PiiRetentionJob {
  private readonly logger = new Logger(PiiRetentionJob.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 30 3 * * *', { name: 'pii-retention', timeZone: 'Pacific/Auckland' })
  async run(now = new Date()): Promise<number> {
    const cutoff = retentionCutoff(now);
    let total = 0;
    for (;;) {
      const { due, done } = await this.batch(cutoff, now);
      total += done;
      // A short batch means nothing more is due; an empty one means the rest is held by someone else (next run).
      if (due < BATCH || done === 0) break;
    }
    const emails = await eraseOutbox(this.prisma, Prisma.sql`created_at < ${cutoff} AND status <> 'PENDING'`);
    if (total || emails) this.logger.log(`pii-retention: anonymized ${total} order(s), erased ${emails} email(s)`);
    return total;
  }

  /** One batch in one transaction: how many orders were due, and how many it anonymized. */
  private async batch(cutoff: Date, now: Date): Promise<{ due: number; done: number }> {
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<{ id: string; buyer_email: string }[]>`
        SELECT o.id, o.buyer_email FROM "order" o JOIN listing l ON l.id = o.listing_id
        WHERE o.anonymized_at IS NULL AND ${settled} AND ${endedBefore(cutoff)}
        ORDER BY o.id LIMIT ${BATCH}`;
      if (!due.length) return { due: 0, done: 0 };
      await lockBuyerEmails(tx, due.map((o) => o.buyer_email));
      // Under the address locks, the orders as they are now, skipping any another transaction holds.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT o.id FROM "order" o
        WHERE o.id = ANY(${due.map((o) => o.id)}::uuid[]) AND o.anonymized_at IS NULL AND ${settled}
        ORDER BY o.id FOR UPDATE OF o SKIP LOCKED`;
      // Then their listings (order → listing, as every path): a reopen or restore under way finishes first, and one
      // that did is seen here, so a listing that is no longer over keeps its buyers.
      const ids = locked.length
        ? (
            await tx.$queryRaw<{ id: string }[]>`
              SELECT o.id FROM "order" o JOIN listing l ON l.id = o.listing_id
              WHERE o.id = ANY(${locked.map((o) => o.id)}::uuid[]) AND ${endedBefore(cutoff)}
              ORDER BY o.id FOR SHARE OF l`
          ).map((o) => o.id)
        : [];
      if (ids.length) {
        await anonymizeOrders(tx, ids, now);
        await tx.auditLog.create({
          data: { actorRole: 'SYSTEM', action: 'PII_RETENTION', targetType: 'order', targetId: ids[0], metadata: { orderCount: ids.length, orderIds: ids } },
        });
      }
      return { due: due.length, done: ids.length };
    });
  }
}
