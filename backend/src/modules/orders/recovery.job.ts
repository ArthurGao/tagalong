import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DAY_MS, utcHour } from '../../common/time.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { lockBuyerEmail } from './anonymize.js';
import { ATTENDING } from './order-ops.js';
import { orderUrl } from './urls.js';

const BATCH = 50;
const RECOVERY_DAYS = 90;
const RECOVERIES_PER_HOUR = 3;

// DESIGN §9: find-my-orders requests only queue a row (OrdersService.recover), so the answer costs the same whether
// or not the address has orders. This job claims requests oldest first (SKIP LOCKED), and for each one sends a single
// email with links to the address's orders of the last 90 days that are paid, registered or done, at most 3 per
// address per clock hour of the request. The n-th has dedupe key ORDER_RECOVERY:{email}:{hour}:{n}, so the unique key
// holds the limit even when two instances handle the same address at once.
@Injectable()
export class RecoveryJob {
  private readonly logger = new Logger(RecoveryJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS, { name: 'recovery' })
  async run(): Promise<number> {
    const queued = await this.prisma.$transaction(async (tx) => {
      const requests = await tx.$queryRaw<{ email: string; locale: string; created_at: Date }[]>`
        DELETE FROM order_recovery_request
        WHERE id IN (SELECT id FROM order_recovery_request ORDER BY created_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
        RETURNING email, locale, created_at`;
      // Not while an address is being anonymized (anonymize.ts). All at once, in one order, so two instances holding
      // requests for the same addresses cannot deadlock.
      for (const email of [...new Set(requests.map((r) => r.email))].sort()) await lockBuyerEmail(tx, email);
      let emails = 0;
      for (const { email, locale, created_at: at } of requests.sort((a, b) => a.created_at.getTime() - b.created_at.getTime())) {
        const hour = utcHour(at);
        const sentThisHour = await tx.notificationOutbox.count({
          where: { type: 'ORDER_RECOVERY', recipient: email, createdAt: { gte: hour.start } },
        });
        if (sentThisHour >= RECOVERIES_PER_HOUR) continue;
        const orders = await tx.order.findMany({
          where: {
            buyerEmail: { equals: email, mode: 'insensitive' },
            status: { in: ATTENDING },
            createdAt: { gt: new Date(at.getTime() - RECOVERY_DAYS * DAY_MS) },
          },
          orderBy: { createdAt: 'desc' },
          select: { publicCode: true, accessToken: true, createdAt: true, listing: { select: { title: true } } },
        });
        if (!orders.length) continue;
        await this.notifications.enqueue(tx, {
          type: 'ORDER_RECOVERY',
          recipient: email,
          locale,
          payload: {
            orders: orders.map((o) => ({
              listingTitle: o.listing.title,
              publicCode: o.publicCode,
              createdAt: o.createdAt.toISOString(),
              url: orderUrl(this.env, locale, o.publicCode, o.accessToken),
            })),
          },
          dedupeKey: `ORDER_RECOVERY:${email}:${hour.key}:${sentThisHour + 1}`,
        });
        emails++;
      }
      return emails;
    });
    if (queued) this.logger.log(`recovery: queued ${queued} email(s)`);
    return queued;
  }
}
