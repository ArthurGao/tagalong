import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import { shortCode } from '../../common/ids.js';
import type { ListingStatus } from '../../generated/prisma/enums.js';
import type { Listing, ListingOption, PickupPoint, Prisma } from '../../generated/prisma/client.js';
import { isUniqueViolation } from '../../prisma/errors.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { type AuthUser, requireMerchantId } from '../auth/auth-user.js';
import { ObjectStorage } from '../uploads/object-storage.js';
import { formFieldIssues, readFormFields, sensitiveFieldKeys, toFormFieldsJson } from './form-fields.js';
import type {
  CreateListingDto,
  ListingDto,
  ListingSummaryDto,
  ReplaceOptionsDto,
  ReplacePickupPointsDto,
  UpdateListingDto,
} from './listing.dto.js';
import { assertListingTransition } from './listing-state-machine.js';
import {
  applyListingDefaults,
  defaultSelfCancelUntil,
  validateListingPatch,
  validateOptionsReplace,
  validatePublishable,
} from './publish-rules.js';

type FullListing = Listing & { options: ListingOption[]; pickupPoints: PickupPoint[] };

const withChildren = {
  options: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
  pickupPoints: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ListingInclude;

/** undefined stays undefined (Prisma: leave unchanged); null clears. */
function toDate(v: string | null): Date | null;
function toDate(v: string | null | undefined): Date | null | undefined;
function toDate(v: string | null | undefined) {
  return v ? new Date(v) : v;
}

const summarySelect = {
  id: true,
  shortCode: true,
  title: true,
  status: true,
  pricing: true,
  type: true,
  soldCount: true,
  totalCapacity: true,
  closesAt: true,
  createdAt: true,
} satisfies Prisma.ListingSelect;

export function toListingSummary(l: Prisma.ListingGetPayload<{ select: typeof summarySelect }>): ListingSummaryDto {
  return {
    id: l.id,
    shortCode: l.shortCode,
    title: l.title,
    status: l.status,
    pricing: l.pricing,
    type: l.type,
    soldCount: l.soldCount,
    totalCapacity: l.totalCapacity,
    closesAt: l.closesAt,
    createdAt: l.createdAt,
  };
}

export function toListingDto(l: FullListing): ListingDto {
  const formFields = readFormFields(l.formFields);
  return {
    ...toListingSummary(l),
    fulfilment: l.fulfilment,
    description: l.description,
    images: l.images,
    opensAt: l.opensAt,
    maxQtyPerOrder: l.maxQtyPerOrder,
    reservedCount: l.reservedCount,
    indexable: l.indexable,
    showParticipants: l.showParticipants,
    formFields,
    formFieldWarnings: sensitiveFieldKeys(formFields),
    onePerEmail: l.onePerEmail,
    allowSelfCancel: l.allowSelfCancel,
    selfCancelUntil: l.selfCancelUntil,
    remindBeforeHours: l.remindBeforeHours,
    policyText: l.policyText,
    publishedAt: l.publishedAt,
    closedAt: l.closedAt,
    options: l.options.map((o) => ({
      id: o.id,
      name: o.name,
      priceCents: o.priceCents,
      capacity: o.capacity,
      soldCount: o.soldCount,
      reservedCount: o.reservedCount,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      location: o.location,
      sortOrder: o.sortOrder,
      active: o.active,
    })),
    pickupPoints: l.pickupPoints.map((p) => ({
      id: p.id,
      label: p.label,
      address: p.address,
      windowStart: p.windowStart,
      windowEnd: p.windowEnd,
      notes: p.notes,
    })),
  };
}

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
  ) {}

  list(user: AuthUser) {
    return this.prisma.listing.findMany({
      where: { merchantId: requireMerchantId(user) },
      orderBy: { createdAt: 'desc' },
      select: summarySelect,
    });
  }

  async create(user: AuthUser, dto: CreateListingDto): Promise<FullListing> {
    const merchantId = requireMerchantId(user);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.listing.create({
          data: {
            merchantId,
            shortCode: shortCode(),
            title: dto.title,
            description: '',
            policyText: '',
            pricing: dto.pricing,
            type: dto.type,
            fulfilment: dto.fulfilment,
            ...applyListingDefaults(dto.type, dto.pricing),
          },
          include: withChildren,
        });
      } catch (e) {
        if (!isUniqueViolation(e) || attempt >= 4) throw e; // a short-code collision: draw again
      }
    }
  }

  get(user: AuthUser, id: string): Promise<FullListing> {
    return this.own(user, id);
  }

  async update(user: AuthUser, id: string, dto: UpdateListingDto): Promise<FullListing> {
    const [listing, hasOrders] = await Promise.all([this.own(user, id), this.hasOrders(id)]);
    const { formFields } = dto;
    if (formFields) {
      const issues = formFieldIssues(formFields);
      if (issues.length) throw new AppError('VALIDATION_FAILED', 'Validation failed', issues);
    }
    if (dto.images?.some((url) => !this.storage.isMerchantImage(url, listing.merchantId))) {
      throw new AppError('VALIDATION_FAILED', 'Validation failed', ['images: upload images first']);
    }
    validateListingPatch({ ...listing, formFields: readFormFields(listing.formFields) }, dto, { hasOrders });
    return this.prisma.listing.update({
      where: { id },
      data: {
        ...dto,
        formFields: formFields && toFormFieldsJson(formFields),
        opensAt: toDate(dto.opensAt),
        closesAt: toDate(dto.closesAt),
        selfCancelUntil: toDate(dto.selfCancelUntil),
      },
      include: withChildren,
    });
  }

  async replaceOptions(user: AuthUser, id: string, dto: ReplaceOptionsDto): Promise<FullListing> {
    const listing = await this.own(user, id);
    const withOrders = await this.prisma.orderItem.findMany({
      where: { option: { listingId: id } },
      select: { optionId: true },
      distinct: ['optionId'],
    });
    const used = new Set(withOrders.map((o) => o.optionId));
    const { priceChanges } = validateOptionsReplace(
      listing.pricing,
      listing.options.map((o) => ({ ...o, hasOrders: used.has(o.id) })),
      dto.options.map((o) => ({ id: o.id, priceCents: o.priceCents, capacity: o.capacity, active: o.active })),
    );
    const keptIds = dto.options.flatMap((o) => (o.id ? [o.id] : []));
    const rows = dto.options.map((o, sortOrder) => ({
      id: o.id,
      data: {
        name: o.name,
        priceCents: o.priceCents,
        capacity: o.capacity,
        startsAt: toDate(o.startsAt ?? null),
        endsAt: toDate(o.endsAt ?? null),
        location: o.location ?? null,
        active: o.active,
        sortOrder,
      },
    }));
    await this.prisma.$transaction(async (tx) => {
      await tx.listingOption.deleteMany({ where: { listingId: id, id: { notIn: keptIds } } });
      for (const row of rows) {
        if (row.id) await tx.listingOption.update({ where: { id: row.id }, data: row.data });
      }
      await tx.listingOption.createMany({ data: rows.filter((r) => !r.id).map((r) => ({ ...r.data, listingId: id })) });
      // Existing orders keep their OrderItem.unitPriceCents snapshot; the change itself is audited (§5b).
      if (listing.status !== 'DRAFT' && priceChanges.length) {
        await tx.auditLog.createMany({
          data: priceChanges.map((c) => ({
            actorUserId: user.id,
            actorRole: 'MERCHANT' as const,
            action: 'LISTING_OPTION_PRICE_CHANGE',
            targetType: 'listing_option',
            targetId: c.optionId,
            metadata: { listingId: id, fromCents: c.fromCents, toCents: c.toCents },
          })),
        });
      }
    });
    return this.own(user, id);
  }

  async replacePickupPoints(user: AuthUser, id: string, dto: ReplacePickupPointsDto): Promise<FullListing> {
    const listing = await this.own(user, id);
    const existing = new Map(listing.pickupPoints.map((p) => [p.id, p]));
    for (const p of dto.pickupPoints) {
      if (p.id && !existing.has(p.id)) {
        throw new AppError('VALIDATION_FAILED', 'Validation failed', [`pickupPoints: unknown pickup point ${p.id}`]);
      }
    }
    const kept = new Set(dto.pickupPoints.flatMap((p) => (p.id ? [p.id] : [])));
    const removed = listing.pickupPoints.filter((p) => !kept.has(p.id)).map((p) => p.id);
    if (removed.length && (await this.prisma.order.count({ where: { pickupPointId: { in: removed } } }))) {
      throw new AppError('PICKUP_POINT_HAS_ORDERS', 'Orders use this pickup point');
    }
    const toData = (p: ReplacePickupPointsDto['pickupPoints'][number]) => ({
      label: p.label,
      address: p.address,
      windowStart: toDate(p.windowStart ?? null),
      windowEnd: toDate(p.windowEnd ?? null),
      notes: p.notes ?? null,
    });
    const moved = new Map(
      dto.pickupPoints.flatMap((p) => (p.id && existing.get(p.id)!.address !== p.address ? [[p.id, p] as const] : [])),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.pickupPoint.deleteMany({ where: { id: { in: removed } } });
      for (const p of dto.pickupPoints) {
        if (p.id) await tx.pickupPoint.update({ where: { id: p.id }, data: toData(p) });
      }
      await tx.pickupPoint.createMany({
        data: dto.pickupPoints.filter((p) => !p.id).map((p) => ({ ...toData(p), listingId: id })),
      });
      if (!moved.size) return;
      // DESIGN §5b: buyers who chose a moved point are told the new address (sent by outbox.job, M5).
      const orders = await tx.order.findMany({
        where: { pickupPointId: { in: [...moved.keys()] } },
        select: { id: true, buyerEmail: true, pickupPointId: true },
      });
      await tx.notificationOutbox.createMany({
        data: orders.map((o) => {
          const point = moved.get(o.pickupPointId!)!;
          return {
            type: 'PICKUP_POINT_CHANGED',
            recipient: o.buyerEmail,
            locale: 'zh-CN',
            payload: { orderId: o.id, listingId: id, label: point.label, address: point.address },
            dedupeKey: `PICKUP_POINT_CHANGED:${o.id}:${point.address}`,
          };
        }),
        skipDuplicates: true,
      });
    });
    return this.own(user, id);
  }

  async publish(user: AuthUser, id: string): Promise<FullListing> {
    const listing = await this.own(user, id);
    // Checked before the publish rules too, so a wrong state reports as such rather than as missing fields.
    assertListingTransition(listing.status, 'PUBLISHED');
    const merchant = await this.prisma.merchant.findUniqueOrThrow({ where: { id: listing.merchantId } });
    validatePublishable({
      listing,
      options: listing.options,
      pickupPointCount: listing.pickupPoints.length,
      merchant,
      now: new Date(),
    });
    const selfCancelUntil =
      listing.allowSelfCancel && !listing.selfCancelUntil
        ? defaultSelfCancelUntil(listing.options.filter((o) => o.active).map((o) => o.startsAt))
        : listing.selfCancelUntil;
    return this.setStatus(listing, 'PUBLISHED', { publishedAt: new Date(), selfCancelUntil });
  }

  async close(user: AuthUser, id: string): Promise<FullListing> {
    const listing = await this.own(user, id);
    return this.setStatus(listing, 'CLOSED', { closedAt: new Date() });
  }

  async reopen(user: AuthUser, id: string, closesAtRaw?: string): Promise<FullListing> {
    const listing = await this.own(user, id);
    const closesAt = closesAtRaw ? new Date(closesAtRaw) : listing.closesAt;
    // Reopening into a past deadline would be closed again by the next job tick.
    if (closesAt && closesAt <= new Date()) throw new AppError('VALIDATION_FAILED', 'Validation failed', ['closesAt']);
    return this.setStatus(listing, 'PUBLISHED', { closesAt, closedAt: null });
  }

  private async setStatus(
    listing: FullListing,
    to: ListingStatus,
    data: Prisma.ListingUpdateManyMutationInput,
  ): Promise<FullListing> {
    assertListingTransition(listing.status, to);
    // Conditional on the status we validated, so a concurrent change (e.g. the auto-close job) wins cleanly.
    const { count } = await this.prisma.listing.updateMany({
      where: { id: listing.id, status: listing.status },
      data: { ...data, status: to },
    });
    if (count === 0) throw new AppError('INVALID_STATE_TRANSITION', 'The listing changed meanwhile; reload');
    return this.prisma.listing.findUniqueOrThrow({ where: { id: listing.id }, include: withChildren });
  }

  private async hasOrders(listingId: string): Promise<boolean> {
    return (await this.prisma.order.findFirst({ where: { listingId }, select: { id: true } })) !== null;
  }

  private async own(user: AuthUser, id: string): Promise<FullListing> {
    const listing = await this.prisma.listing.findFirst({
      where: { id, merchantId: requireMerchantId(user) },
      include: withChildren,
    });
    if (!listing) throw new AppError('NOT_FOUND', 'Listing not found');
    return listing;
  }
}
