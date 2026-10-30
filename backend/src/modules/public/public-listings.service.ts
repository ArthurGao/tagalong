import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import { maskName } from '../../common/mask.js';
import type { OrderStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { readFormFields } from '../listings/form-fields.js';
import { toPickupPointDto } from '../listings/listings.service.js';
import { availabilityOf, isTakenDown, remainingPlaces } from '../listings/availability.js';
import type { ParticipantPageDto, PublicListingDto } from './public-listing.dto.js';

// Orders that hold a place on the sign-up sheet. Cancelled, refunded, expired and no-show rows drop out;
// their sequence numbers are never reused (DESIGN §6).
const LISTED: OrderStatus[] = ['PAID', 'CONFIRMED', 'FULFILLED', 'PARTIALLY_REFUNDED'];
const PAGE_SIZE = 20;

// Drafts are never public.
const publicWhere = (shortCode: string) => ({ shortCode, status: { not: 'DRAFT' as const } });

@Injectable()
export class PublicListingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(shortCode: string): Promise<PublicListingDto> {
    const l = await this.prisma.listing.findFirst({
      where: publicWhere(shortCode),
      include: {
        merchant: { select: { slug: true, displayName: true, logoUrl: true, chargesEnabled: true, status: true } },
        options: { where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        pickupPoints: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!l) throw new AppError('NOT_FOUND', 'Listing not found');
    const options = l.options.map((o) => ({
      id: o.id,
      name: o.name,
      priceCents: o.priceCents,
      remaining: remainingPlaces(o.capacity, o.soldCount, o.reservedCount),
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      location: o.location,
    }));
    const totalRemaining = remainingPlaces(l.totalCapacity, l.soldCount, l.reservedCount);
    const dto: PublicListingDto = {
      shortCode: l.shortCode,
      title: l.title,
      description: l.description,
      images: l.images,
      type: l.type,
      pricing: l.pricing,
      fulfilment: l.fulfilment,
      status: l.status,
      availability: availabilityOf(l, new Date()),
      opensAt: l.opensAt,
      closesAt: l.closesAt,
      maxQtyPerOrder: l.maxQtyPerOrder,
      policyText: l.policyText,
      indexable: l.indexable,
      showParticipants: l.showParticipants,
      joinedCount: l.soldCount,
      totalCapacity: l.totalCapacity,
      totalRemaining,
      formFields: readFormFields(l.formFields),
      options,
      pickupPoints: l.pickupPoints.map(toPickupPointDto),
      merchant: {
        slug: l.merchant.slug,
        displayName: l.merchant.displayName,
        logoUrl: l.merchant.logoUrl,
        verified: l.merchant.chargesEnabled,
      },
    };
    return dto.availability === 'TAKEN_DOWN' ? redactTakenDown(dto) : dto;
  }

  /** Newest first by sequence number; `cursor` is the last seq of the previous page. */
  async participants(shortCode: string, cursor?: number, limit = PAGE_SIZE): Promise<ParticipantPageDto> {
    const listing = await this.prisma.listing.findFirst({
      where: publicWhere(shortCode),
      select: { id: true, showParticipants: true, status: true, takenDownAt: true },
    });
    if (!listing || !listing.showParticipants || isTakenDown(listing)) throw new AppError('NOT_FOUND', 'Listing not found');
    const rows = await this.prisma.order.findMany({
      where: {
        listingId: listing.id,
        status: { in: LISTED },
        sequenceNo: { not: null, lt: cursor },
      },
      orderBy: { sequenceNo: 'desc' },
      take: limit + 1,
      // Only what the sheet shows; the name is masked below and never leaves this method in clear.
      select: {
        sequenceNo: true,
        buyerName: true,
        displayAnonymous: true,
        paidAt: true,
        createdAt: true,
        items: { select: { quantity: true, option: { select: { name: true, sortOrder: true } } } },
      },
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((o) => ({
        seq: o.sequenceNo!,
        displayName: o.displayAnonymous ? null : maskName(o.buyerName),
        anonymous: o.displayAnonymous,
        summary: [...o.items]
          .sort((a, b) => a.option.sortOrder - b.option.sortOrder)
          .map((i) => `${i.option.name} ×${i.quantity}`)
          .join(', '),
        joinedAt: o.paidAt ?? o.createdAt,
      })),
      nextCursor: rows.length > limit ? page[page.length - 1].sequenceNo : null,
    };
  }
}

/**
 * Admins cannot edit merchant content, only take it down (DESIGN §9 admin), so a taken-down listing serves none of
 * it: the page shows only the "taken down" notice and the seller's name. Built field by field (no spread), so a
 * field added to PublicListingDto fails to compile here until someone decides whether it is content.
 */
function redactTakenDown(dto: PublicListingDto): PublicListingDto {
  return {
    shortCode: dto.shortCode,
    availability: dto.availability,
    status: dto.status,
    type: dto.type,
    pricing: dto.pricing,
    fulfilment: dto.fulfilment,
    opensAt: null,
    closesAt: null,
    maxQtyPerOrder: dto.maxQtyPerOrder,
    joinedCount: 0,
    totalCapacity: null,
    totalRemaining: null,
    merchant: { ...dto.merchant, logoUrl: null },
    title: '',
    description: '',
    images: [],
    policyText: '',
    indexable: false,
    showParticipants: false,
    formFields: [],
    options: [],
    pickupPoints: [],
  };
}
