import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { availabilityOf, priceSpan } from '../listings/availability.js';
import type { MerchantPageDto } from './public-merchant.dto.js';

// The newest listings only: a long-lived merchant's page stays small.
const MAX_LISTINGS = 50;

@Injectable()
export class PublicMerchantsService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /public/merchants/:slug — published and closed listings, newest first; drafts and cancelled ones never. */
  async get(slug: string, now = new Date()): Promise<MerchantPageDto> {
    const m = await this.prisma.merchant.findUnique({
      where: { slug },
      select: { id: true, slug: true, displayName: true, description: true, logoUrl: true, status: true },
    });
    if (!m) throw new AppError('NOT_FOUND', 'Merchant not found');
    const suspended = m.status === 'SUSPENDED';
    const listings = suspended
      ? []
      : await this.prisma.listing.findMany({
          where: { merchantId: m.id, status: { in: ['PUBLISHED', 'CLOSED'] } },
          orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
          take: MAX_LISTINGS,
          select: {
            shortCode: true, title: true, images: true, type: true, pricing: true, status: true, takenDownAt: true, opensAt: true,
            closesAt: true, totalCapacity: true, soldCount: true, reservedCount: true,
            options: { where: { active: true }, select: { active: true, priceCents: true, capacity: true, soldCount: true, reservedCount: true } },
          },
        });
    return {
      slug: m.slug,
      displayName: m.displayName,
      description: m.description,
      logoUrl: m.logoUrl,
      suspended,
      listings: listings.map((l) => ({
        shortCode: l.shortCode,
        title: l.title,
        coverImageUrl: l.images[0] ?? null,
        type: l.type,
        pricing: l.pricing,
        ...priceSpan(l.options.map((o) => o.priceCents)),
        availability: availabilityOf({ ...l, merchant: { status: m.status } }, now),
        closesAt: l.closesAt,
      })),
    };
  }
}
