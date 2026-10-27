import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service.js';

// DESIGN §5b: PUBLISHED listings close once closesAt passes. One conditional UPDATE, so it is atomic and
// safe on any number of instances; the frontend countdown is cosmetic.
@Injectable()
export class ListingCloseJob {
  private readonly logger = new Logger(ListingCloseJob.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'listing-close' })
  async closeDue(now = new Date()): Promise<number> {
    const { count } = await this.prisma.listing.updateMany({
      where: { status: 'PUBLISHED', closesAt: { lte: now } },
      data: { status: 'CLOSED', closedAt: now },
    });
    if (count) this.logger.log(`listing-close: closed ${count} listing(s)`);
    return count;
  }
}
