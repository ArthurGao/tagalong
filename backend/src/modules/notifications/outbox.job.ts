import { Injectable, Logger } from '@nestjs/common';
import { errorText } from '../../common/errors/error-text.js';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { NotificationOutbox } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EmailService } from './email.service.js';
import { renderEmail, UnknownTemplateError } from './templates.js';

const BATCH = 20;
// A claimed row is invisible to other instances for this long; a crash mid-send just retries it later.
const LEASE_MS = 5 * 60_000;
const MINUTE = 60_000;
// DESIGN §12: retry after 1, 5, 30 minutes, 2 hours, 12 hours; the attempt after the last delay is final.
export const RETRY_DELAYS_MS = [1 * MINUTE, 5 * MINUTE, 30 * MINUTE, 120 * MINUTE, 720 * MINUTE];

/** When to try again after `attempts` failed sends, or null when the row should be marked FAILED. */
export function nextAttemptAt(attempts: number, now: Date): Date | null {
  const delay = RETRY_DELAYS_MS[attempts - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay);
}

@Injectable()
export class OutboxJob {
  private readonly logger = new Logger(OutboxJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS, { name: 'outbox' })
  async run(now = new Date()): Promise<{ sent: number; retrying: number; failed: number }> {
    // Claim a batch (SKIP LOCKED, so instances never pick the same rows), then send outside the transaction.
    const rows = await this.prisma.$queryRaw<NotificationOutbox[]>`
      UPDATE notification_outbox SET next_attempt_at = ${new Date(now.getTime() + LEASE_MS)}
      WHERE id IN (
        SELECT id FROM notification_outbox
        WHERE status = 'PENDING' AND next_attempt_at <= ${now}
        ORDER BY next_attempt_at
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, type, recipient, locale, payload, attempts`;
    const result = { sent: 0, retrying: 0, failed: 0 };
    for (const row of rows) {
      try {
        await this.email.send(renderEmail(row.type, row.locale, row.recipient, row.payload));
        await this.prisma.notificationOutbox.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date() } });
        result.sent++;
      } catch (e) {
        const attempts = row.attempts + 1;
        // A missing template will never succeed: fail at once instead of retrying for a day.
        const retryAt = e instanceof UnknownTemplateError ? null : nextAttemptAt(attempts, now);
        const lastError = errorText(e);
        await this.prisma.notificationOutbox.update({
          where: { id: row.id },
          data: retryAt ? { attempts, lastError, nextAttemptAt: retryAt } : { attempts, lastError, status: 'FAILED' },
        });
        if (retryAt) result.retrying++;
        else {
          result.failed++;
          // Sentry arrives in M9; until then FAILED rows are logged at error level.
          this.logger.error(`outbox: ${row.type} ${row.id} FAILED after ${attempts} attempt(s): ${lastError}`);
        }
      }
    }
    if (rows.length) this.logger.log(`outbox: sent ${result.sent}, retrying ${result.retrying}, failed ${result.failed}`);
    return result;
  }
}
