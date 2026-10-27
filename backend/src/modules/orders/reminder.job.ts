import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { EventReminderPayload } from '../notifications/templates.js';
import { calendarEvents, orderDetail } from './order-ops.js';
import { orderUrl } from './urls.js';

const BATCH = 100;
const DEFAULT_REMIND_BEFORE_HOURS = 24;
const MAX_REMIND_BEFORE_HOURS = 168; // listing.dto's limit on remindBeforeHours

// DESIGN §12: event and lesson orders (paid and free) are reminded `remindBeforeHours` before their first session that
// is still ahead. reminder_sent_at is set and the email queued in one transaction, so each order is reminded once,
// whichever instance gets there; an order placed inside the window is reminded at the next run, a past event never.
@Injectable()
export class ReminderJob {
  private readonly logger = new Logger(ReminderJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Cron('0 */15 * * * *', { name: 'reminder' })
  async remindDue(now = new Date()): Promise<number> {
    const reminded = await this.prisma.$transaction(async (tx) => {
      // Candidates come from sessions starting within the longest window (index on starts_at); an order whose next
      // session is inside its listing's window has its first upcoming session there too.
      const due = await tx.$queryRaw<{ id: string }[]>`
        UPDATE "order" SET reminder_sent_at = ${now}, updated_at = now()
        WHERE id IN (
          SELECT o.id FROM "order" o
          WHERE o.status IN ('PAID', 'CONFIRMED') AND o.reminder_sent_at IS NULL
            AND o.id IN (
              SELECT oi.order_id FROM listing_option lo
              JOIN listing l ON l.id = lo.listing_id AND l.type IN ('SESSION', 'EVENT')
              JOIN order_item oi ON oi.option_id = lo.id
              WHERE lo.starts_at > ${now} AND lo.starts_at <= ${now}::timestamp + make_interval(hours => ${MAX_REMIND_BEFORE_HOURS})
                AND lo.starts_at <= ${now}::timestamp + make_interval(hours => COALESCE(l.remind_before_hours, ${DEFAULT_REMIND_BEFORE_HOURS}))
            )
          ORDER BY o.id LIMIT ${BATCH}
          FOR UPDATE OF o SKIP LOCKED
        )
        RETURNING id`;
      const orders = await tx.order.findMany({ where: { id: { in: due.map((o) => o.id) } }, include: orderDetail });
      await this.notifications.enqueue(
        tx,
        ...orders.map((order) => ({
          type: 'EVENT_REMINDER',
          recipient: order.buyerEmail,
          locale: order.locale,
          payload: {
            publicCode: order.publicCode,
            listingTitle: order.listing.title,
            orderUrl: orderUrl(this.env, order.locale, order.publicCode, order.accessToken),
            events: calendarEvents(this.env, order)
              .filter((e) => new Date(e.startsAt) > now)
              .sort((x, y) => x.startsAt.localeCompare(y.startsAt)),
          } satisfies EventReminderPayload,
          dedupeKey: `EVENT_REMINDER:${order.id}`,
        })),
      );
      return orders.length;
    });
    if (reminded) this.logger.log(`reminder: queued ${reminded} reminder(s)`);
    return reminded;
  }
}
