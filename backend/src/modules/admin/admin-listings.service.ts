import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import type { Listing, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { isTakenDown } from '../listings/availability.js';
import { canListingTransition, canRestoreListing } from '../listings/listing-state-machine.js';
import { ListingsService } from '../listings/listings.service.js';
import { NotificationsService, toMerchant } from '../notifications/notifications.service.js';
import { CancellationService } from '../orders/cancellation.service.js';
import type { AdminListingBriefDto, AdminListingDto, AdminListingPageDto, AdminListingRowDto, AdminListingsQueryDto } from './admin.dto.js';
import { type AdminActor, recordAudit } from './audit.js';
import { merchantRef, PAGE, page } from './paging.js';

const rowInclude = { merchant: merchantRef };

@Injectable()
export class AdminListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly cancellations: CancellationService,
    private readonly notifications: NotificationsService,
  ) {}

  /** GET /admin/listings: every merchant's listings, newest first, 50 a page. */
  async list(query: AdminListingsQueryDto): Promise<AdminListingPageDto> {
    const q = query.q?.trim();
    const rows = await this.prisma.listing.findMany({
      where: {
        ...(query.merchantId && { merchantId: query.merchantId }),
        ...(query.status && { status: query.status }),
        ...(query.pricing && { pricing: query.pricing }),
        ...(q && { OR: [{ title: { contains: q, mode: 'insensitive' } }, { shortCode: q }] }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
      include: rowInclude,
    });
    return page(rows.map(toRow));
  }

  /** GET /admin/listings/:id: options, order counts, the cancellation if any, and which actions apply. */
  async get(id: string): Promise<AdminListingDto> {
    const [l, counts] = await Promise.all([
      this.prisma.listing.findUnique({ where: { id }, include: { ...rowInclude, options: { orderBy: { sortOrder: 'asc' } }, cancellation: true } }),
      this.prisma.order.groupBy({ by: ['status'], where: { listingId: id }, _count: true, orderBy: { status: 'asc' } }),
    ]);
    if (!l) throw new AppError('NOT_FOUND', 'Listing not found');
    const progress = l.cancellation && (await this.cancellations.progressOf(id));
    return {
      ...toRow(l),
      description: l.description,
      takenDownReason: l.takenDownReason,
      takenDownAt: l.takenDownAt,
      options: l.options.map((o) => ({
        name: o.name,
        priceCents: o.priceCents,
        capacity: o.capacity,
        soldCount: o.soldCount,
        reservedCount: o.reservedCount,
        active: o.active,
      })),
      orderCounts: counts.map((c) => ({ status: c.status, count: c._count })),
      cancellation: l.cancellation && progress && { ...progress, reason: l.cancellation.reason, refundAll: l.cancellation.refundAll, createdAt: l.cancellation.createdAt },
      canClose: canListingTransition(l.status, 'CLOSED'),
      canTakedown: canListingTransition(l.status, 'CANCELLED'),
      canRestore: canRestoreListing(l),
    };
  }

  /** POST /admin/listings/:id/close: closes early; orders stay. */
  async close(actor: AdminActor, id: string, reason: string): Promise<AdminListingDto> {
    await this.listings.closeAsAdmin(id, (tx) => recordAudit(tx, actor, { action: 'LISTING_CLOSE', targetType: 'listing', targetId: id, reason }));
    return this.get(id);
  }

  /**
   * POST /admin/listings/:id/takedown (DESIGN §9): the listing ends like a cancellation (with refunds and cancelled
   * registrations if asked), is marked taken down so the public page says so, and the merchant is told why.
   */
  async takedown(actor: AdminActor, id: string, request: { reason: string; refundAll: boolean }): Promise<AdminListingDto> {
    await this.cancellations.endAsAdmin(actor.userId, id, request, async (tx, cancellationId) => {
      const listing = await tx.listing.update({
        where: { id },
        data: { takenDownAt: new Date(), takenDownReason: request.reason },
        select: { title: true, merchant: { select: { contactEmail: true } } },
      });
      await recordAudit(tx, actor, { action: 'LISTING_TAKEDOWN', targetType: 'listing', targetId: id, reason: request.reason, metadata: { refundAll: request.refundAll } });
      await this.notifications.enqueue(tx, {
        type: 'LISTING_TAKEN_DOWN',
        ...toMerchant(listing.merchant),
        payload: { listingTitle: listing.title, ...request },
        dedupeKey: `LISTING_TAKEN_DOWN:${cancellationId}`,
      });
    });
    return this.get(id);
  }

  /** POST /admin/listings/:id/restore: only a takedown that refunded and cancelled nothing; it comes back CLOSED. */
  async restore(actor: AdminActor, id: string, reason: string): Promise<AdminListingDto> {
    await this.listings.restoreAsAdmin(id, (tx) => recordAudit(tx, actor, { action: 'LISTING_RESTORE', targetType: 'listing', targetId: id, reason }));
    return this.get(id);
  }
}

export const briefSelect = {
  id: true,
  shortCode: true,
  title: true,
  status: true,
  pricing: true,
  soldCount: true,
  takenDownAt: true,
  createdAt: true,
} satisfies Prisma.ListingSelect;

/** A listing as the merchant drawer lists it. */
export function toBrief(l: Prisma.ListingGetPayload<{ select: typeof briefSelect }>): AdminListingBriefDto {
  return {
    id: l.id,
    shortCode: l.shortCode,
    title: l.title,
    status: l.status,
    pricing: l.pricing,
    soldCount: l.soldCount,
    takenDown: isTakenDown(l),
    createdAt: l.createdAt,
  };
}

function toRow(l: Listing & { merchant: AdminListingRowDto['merchant'] }): AdminListingRowDto {
  return { ...toBrief(l), closesAt: l.closesAt, merchant: l.merchant };
}
