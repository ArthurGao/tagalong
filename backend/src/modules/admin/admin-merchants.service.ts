import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import { DAY_MS } from '../../common/time.js';
import type { Merchant, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService, toMerchant } from '../notifications/notifications.service.js';
import type { AdminMerchantDto, AdminMerchantPageDto, AdminMerchantRowDto, AdminMerchantsQueryDto, MerchantNoteDto } from './admin.dto.js';
import { type AdminActor, recordAudit } from './audit.js';
import { briefSelect, toBrief } from './admin-listings.service.js';
import { PAGE, page } from './paging.js';
import { riskFlags, riskMetrics } from './risk.js';

@Injectable()
export class AdminMerchantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * GET /admin/merchants: newest first, 50 a page. Risk flags are computed live (DESIGN §9); with `risk` only flagged
   * merchants are listed, so the flags of every matching merchant are computed first (fine at MVP scale).
   */
  async list(query: AdminMerchantsQueryDto, now = new Date()): Promise<AdminMerchantPageDto> {
    const q = query.q?.trim();
    const where: Prisma.MerchantWhereInput = {
      ...(query.status && { status: query.status }),
      ...(q && {
        OR: [
          { displayName: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q.toLowerCase() } },
          { contactEmail: { contains: q, mode: 'insensitive' } },
        ],
      }),
    };
    const newestFirst = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
    const rowsOf = async (merchants: RowMerchant[]) => {
      const metrics = await riskMetrics(this.prisma, merchants, now);
      return merchants.map((m) => toRow(m, riskFlags(metrics.get(m.id)!, now)));
    };
    if (query.risk) {
      // Only these can carry a flag: new, an open dispute, or paid orders in the last 90 days (refund rate and spike).
      const candidates = await this.prisma.merchant.findMany({
        where: {
          AND: [
            where,
            {
              OR: [
                { createdAt: { gt: new Date(now.getTime() - 7 * DAY_MS) } },
                { disputes: { some: { open: true } } },
                { orders: { some: { isFree: false, paidAt: { gte: new Date(now.getTime() - 90 * DAY_MS) } } } },
              ],
            },
          ],
        },
        orderBy: newestFirst,
        select: rowSelect,
      });
      const flagged = (await rowsOf(candidates)).filter((r) => r.riskFlags.length);
      const start = query.cursor ? flagged.findIndex((r) => r.id === query.cursor) + 1 : 0;
      return page(flagged.slice(start, start + PAGE + 1));
    }
    const merchants = await this.prisma.merchant.findMany({
      where,
      orderBy: newestFirst,
      take: PAGE + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
      select: rowSelect,
    });
    return page(await rowsOf(merchants));
  }

  /** GET /admin/merchants/:id: profile, Stripe state, risk figures, listings and notes. */
  async get(id: string, now = new Date()): Promise<AdminMerchantDto> {
    const m = await this.prisma.merchant.findUnique({
      where: { id },
      include: {
        owner: { select: { deletedAt: true } },
        listings: { orderBy: { createdAt: 'desc' }, take: 50, select: briefSelect },
        notes: { orderBy: { createdAt: 'desc' }, include: { author: { select: { email: true } } } },
        _count: { select: { orders: { where: { status: { notIn: ['PENDING_PAYMENT', 'EXPIRED'] } } }, disputes: true } },
      },
    });
    if (!m) throw new AppError('NOT_FOUND', 'Merchant not found');
    const figures = (await riskMetrics(this.prisma, [m], now)).get(m.id)!;
    return {
      ...toRow(m, riskFlags(figures, now)),
      description: m.description,
      contactPhone: m.contactPhone,
      gstNumber: m.gstNumber,
      suspendedReason: m.suspendedReason,
      suspendedAt: m.suspendedAt,
      ownerDeleted: m.owner.deletedAt !== null,
      stripeAccountId: m.stripeAccountId,
      payoutsEnabled: m.payoutsEnabled,
      detailsSubmitted: m.detailsSubmitted,
      figures: {
        paidCents90d: figures.paidCents90d,
        refundedCents90d: figures.refundedCents90d,
        openDisputes: figures.openDisputes,
        todayCents: figures.todayCents,
        previous30dCents: figures.previous30dCents,
      },
      orderCount: m._count.orders,
      disputeCount: m._count.disputes,
      listings: m.listings.map(toBrief),
      notes: m.notes.map((n) => ({ id: n.id, note: n.note, authorEmail: n.author.email, createdAt: n.createdAt })),
    };
  }

  /** POST /admin/merchants/:id/suspend: every listing stops selling at once (availability SUSPENDED); orders stay. */
  async suspend(actor: AdminActor, id: string, reason: string): Promise<AdminMerchantDto> {
    await this.prisma.$transaction(async (tx) => {
      const merchant = await this.change(tx, id, 'ACTIVE', { status: 'SUSPENDED', suspendedReason: reason, suspendedAt: new Date() });
      await recordAudit(tx, actor, { action: 'MERCHANT_SUSPEND', targetType: 'merchant', targetId: id, reason });
      await this.notifications.enqueue(tx, {
        type: 'MERCHANT_SUSPENDED',
        ...toMerchant(merchant),
        payload: { merchantName: merchant.displayName, reason },
        dedupeKey: `MERCHANT_SUSPENDED:${id}:${merchant.suspendedAt!.toISOString()}`,
      });
    });
    return this.get(id);
  }

  /** POST /admin/merchants/:id/reinstate. A shop whose owner deleted their account stays suspended. */
  async reinstate(actor: AdminActor, id: string, reason: string): Promise<AdminMerchantDto> {
    await this.prisma.$transaction(async (tx) => {
      // Lock the owner first (user → merchant, the order account deletion uses): a deletion in flight is waited for and
      // seen, and one that starts later finds the shop active and suspends it again.
      const [owner] = await tx.$queryRaw<{ deleted_at: Date | null }[]>`
        SELECT u.deleted_at FROM "user" u JOIN merchant m ON m.owner_user_id = u.id WHERE m.id = ${id}::uuid FOR UPDATE OF u`;
      if (owner?.deleted_at) {
        throw new AppError('INVALID_STATE_TRANSITION', 'The owner deleted their account', { from: 'SUSPENDED', to: 'ACTIVE' });
      }
      const merchant = await this.change(tx, id, 'SUSPENDED', { status: 'ACTIVE', suspendedReason: null, suspendedAt: null });
      await recordAudit(tx, actor, { action: 'MERCHANT_REINSTATE', targetType: 'merchant', targetId: id, reason });
      await this.notifications.enqueue(tx, {
        type: 'MERCHANT_REINSTATED',
        ...toMerchant(merchant),
        payload: { merchantName: merchant.displayName },
        dedupeKey: `MERCHANT_REINSTATED:${id}:${merchant.updatedAt.toISOString()}`,
      });
    });
    return this.get(id);
  }

  /** POST /admin/merchants/:id/notes: append-only, admins only. */
  async addNote(actor: AdminActor, id: string, note: string): Promise<MerchantNoteDto> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.merchant.findUnique({ where: { id }, select: { id: true } }))) throw new AppError('NOT_FOUND', 'Merchant not found');
      const row = await tx.merchantNote.create({ data: { merchantId: id, authorUserId: actor.userId, note }, include: { author: { select: { email: true } } } });
      await recordAudit(tx, actor, { action: 'MERCHANT_NOTE', targetType: 'merchant', targetId: id, reason: null, metadata: { noteId: row.id } });
      return { id: row.id, note: row.note, authorEmail: row.author.email, createdAt: row.createdAt };
    });
  }

  /** One conditional status change: a merchant already in the other state (or a concurrent change) is refused. */
  private async change(tx: Prisma.TransactionClient, id: string, from: Merchant['status'], data: Prisma.MerchantUpdateManyMutationInput): Promise<Merchant> {
    const { count } = await tx.merchant.updateMany({ where: { id, status: from }, data });
    if (count) return tx.merchant.findUniqueOrThrow({ where: { id } });
    const current = await tx.merchant.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw new AppError('NOT_FOUND', 'Merchant not found');
    throw new AppError('INVALID_STATE_TRANSITION', `Merchant is ${current.status}`, { from: current.status, to: data.status as string });
  }
}

const rowSelect = {
  id: true,
  slug: true,
  displayName: true,
  contactEmail: true,
  status: true,
  chargesEnabled: true,
  createdAt: true,
} satisfies Prisma.MerchantSelect;
type RowMerchant = Prisma.MerchantGetPayload<{ select: typeof rowSelect }>;

function toRow(m: RowMerchant, flags: AdminMerchantRowDto['riskFlags']): AdminMerchantRowDto {
  return {
    id: m.id,
    slug: m.slug,
    displayName: m.displayName,
    contactEmail: m.contactEmail,
    status: m.status,
    chargesEnabled: m.chargesEnabled,
    riskFlags: flags,
    createdAt: m.createdAt,
  };
}
