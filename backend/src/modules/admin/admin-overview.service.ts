import { Injectable } from '@nestjs/common';
import { aucklandDayStart, DAY_MS } from '../../common/time.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { merchantRef } from './paging.js';
import type { AdminDisputeDto, AdminDisputesQueryDto, AdminStatsDto } from './admin.dto.js';

@Injectable()
export class AdminOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /admin/stats: the overview's four numbers (DESIGN §11). GMV is what buyers paid, refunds included. */
  async stats(now = new Date()): Promise<AdminStatsDto> {
    const since = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const [newMerchantsToday, [gmv], openDisputes] = await Promise.all([
      this.prisma.merchant.count({ where: { createdAt: { gte: aucklandDayStart(now) } } }),
      // One pass over the 30 days, the 7 inside it.
      this.prisma.$queryRaw<{ gmv7: bigint; gmv30: bigint }[]>`
        SELECT COALESCE(SUM(total_cents) FILTER (WHERE paid_at >= ${since(7)}), 0) AS gmv7, COALESCE(SUM(total_cents), 0) AS gmv30
        FROM "order" WHERE NOT is_free AND paid_at >= ${since(30)}`,
      this.prisma.dispute.count({ where: { open: true } }),
    ]);
    return { newMerchantsToday, gmv7dCents: Number(gmv.gmv7), gmv30dCents: Number(gmv.gmv30), openDisputes };
  }

  /** GET /admin/disputes: the newest (up to 200), open or closed or both. */
  async disputes(query: AdminDisputesQueryDto): Promise<AdminDisputeDto[]> {
    const rows = await this.prisma.dispute.findMany({
      where: query.status ? { open: query.status === 'open' } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 200,
      include: { order: { select: { publicCode: true, listing: { select: { title: true } } } }, merchant: merchantRef },
    });
    return rows.map((d) => ({
      id: d.id,
      status: d.status,
      open: d.open,
      amountCents: d.amountCents,
      reason: d.reason,
      createdAt: d.createdAt,
      closedAt: d.closedAt,
      orderPublicCode: d.order.publicCode,
      listingTitle: d.order.listing.title,
      merchant: d.merchant,
    }));
  }
}
