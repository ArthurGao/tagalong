import { aucklandDayStart, DAY_MS } from '../../common/time.js';
import type { PrismaClient } from '../../generated/prisma/client.js';

export const RISK_FLAGS = ['NEW_MERCHANT', 'HIGH_REFUND_RATE', 'OPEN_DISPUTE', 'GMV_SPIKE'] as const;
export type RiskFlag = (typeof RISK_FLAGS)[number];

/** What the risk rules read about one merchant; money in cents, paid orders only. */
export interface RiskMetrics {
  createdAt: Date;
  /** Paid in the last 90 days, and how much of that was refunded. */
  paidCents90d: number;
  refundedCents90d: number;
  openDisputes: number;
  /** Paid since Auckland midnight, and in the 30 Auckland days before it. */
  todayCents: number;
  previous30dCents: number;
}

/**
 * DESIGN §9 risk flags, computed live (no rules engine): new (under 7 days), refund rate above 10%, an open dispute,
 * or today's GMV above 5 times the merchant's daily average over the previous 30 days. A first sale after a quiet
 * month counts as a spike: an admin looks, nothing is blocked.
 */
export function riskFlags(m: RiskMetrics, now: Date): RiskFlag[] {
  const flags: RiskFlag[] = [];
  if (now.getTime() - m.createdAt.getTime() < 7 * DAY_MS) flags.push('NEW_MERCHANT');
  if (m.refundedCents90d * 10 > m.paidCents90d && m.paidCents90d > 0) flags.push('HIGH_REFUND_RATE');
  if (m.openDisputes > 0) flags.push('OPEN_DISPUTE');
  // today > 5 × (previous30d / 30), in integers.
  if (m.todayCents * 30 > 5 * m.previous30dCents) flags.push('GMV_SPIKE');
  return flags;
}

/** The risk metrics of these merchants, in two queries. Merchants without paid orders get zeros. */
export async function riskMetrics(
  prisma: Pick<PrismaClient, '$queryRaw' | 'dispute'>,
  merchants: { id: string; createdAt: Date }[],
  now: Date,
): Promise<Map<string, RiskMetrics>> {
  const ids = merchants.map((m) => m.id);
  const today = aucklandDayStart(now);
  const since90 = new Date(now.getTime() - 90 * DAY_MS);
  const since30 = aucklandDayStart(now, 30);
  const earliest = since90 < since30 ? since90 : since30;
  const [sums, disputes] = await Promise.all([
    ids.length
      ? prisma.$queryRaw<{ merchant_id: string; paid90: bigint; refunded90: bigint; today: bigint; previous30: bigint }[]>`
          SELECT merchant_id,
            COALESCE(SUM(total_cents) FILTER (WHERE paid_at >= ${since90}), 0) AS paid90,
            COALESCE(SUM(refunded_cents) FILTER (WHERE paid_at >= ${since90}), 0) AS refunded90,
            COALESCE(SUM(total_cents) FILTER (WHERE paid_at >= ${today}), 0) AS today,
            COALESCE(SUM(total_cents) FILTER (WHERE paid_at >= ${since30} AND paid_at < ${today}), 0) AS previous30
          FROM "order"
          WHERE merchant_id = ANY(${ids}::uuid[]) AND NOT is_free AND paid_at >= ${earliest}
          GROUP BY merchant_id`
      : [],
    prisma.dispute.groupBy({ by: ['merchantId'], where: { merchantId: { in: ids }, open: true }, _count: true }),
  ]);
  const sumOf = new Map(sums.map((s) => [s.merchant_id, s]));
  const openOf = new Map(disputes.map((d) => [d.merchantId, d._count]));
  return new Map(
    merchants.map((m) => {
      const s = sumOf.get(m.id);
      return [
        m.id,
        {
          createdAt: m.createdAt,
          paidCents90d: Number(s?.paid90 ?? 0),
          refundedCents90d: Number(s?.refunded90 ?? 0),
          openDisputes: openOf.get(m.id) ?? 0,
          todayCents: Number(s?.today ?? 0),
          previous30dCents: Number(s?.previous30 ?? 0),
        },
      ];
    }),
  );
}
