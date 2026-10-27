import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service.js';
import { StripeClient } from '../stripe/stripe-client.js';
import { endUnpaid, expireSessions, orderDetail, sessionsToEnd } from './order-ops.js';

const BATCH = 50;

// DESIGN §7.4: unpaid orders past their reservation give their places back. Paid orders only (free orders never
// hold stock). SKIP LOCKED keeps instances apart; Checkout sessions are ended after the commit, best effort.
@Injectable()
export class ExpiryJob {
  private readonly logger = new Logger(ExpiryJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeClient,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'order-expiry' })
  async expireDue(now = new Date()): Promise<number> {
    const { count, ended } = await this.prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "order"
        WHERE status = 'PENDING_PAYMENT' AND reservation_expires_at < ${now}
        ORDER BY reservation_expires_at
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED`;
      const ended = [];
      for (const { id } of due) {
        const order = await tx.order.findUniqueOrThrow({ where: { id }, include: orderDetail });
        await endUnpaid(tx, order, 'EXPIRED');
        ended.push(...sessionsToEnd(order));
      }
      return { count: due.length, ended };
    });
    await expireSessions(this.stripe, this.logger, ended);
    if (count) this.logger.log(`order-expiry: expired ${count} order(s)`);
    return count;
  }
}
