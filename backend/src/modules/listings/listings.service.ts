import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import { shortCode } from '../../common/ids.js';
import type { Listing, ListingOption, PickupPoint, Prisma } from '../../generated/prisma/client.js';
import { isForeignKeyViolation, isUniqueViolation } from '../../prisma/errors.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { PickupPointChangedPayload } from '../notifications/templates.js';
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
    revision: l.revision,
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
    private readonly notifications: NotificationsService,
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
    const { revision, ...fields } = dto;
    return this.mutate(user, id, revision, async (tx, listing) => {
      if (fields.formFields) {
        const issues = formFieldIssues(fields.formFields);
        if (issues.length) throw new AppError('VALIDATION_FAILED', 'Validation failed', issues);
      }
      if (fields.images?.some((url) => !this.storage.isMerchantImage(url, listing.merchantId))) {
        throw new AppError('VALIDATION_FAILED', 'Validation failed', ['images: upload images first']);
      }
      const hasOrders = (await tx.order.findFirst({ where: { listingId: id }, select: { id: true } })) !== null;
      validateListingPatch({ ...listing, formFields: readFormFields(listing.formFields) }, fields, { hasOrders });
      return {
        ...fields,
        formFields: fields.formFields && toFormFieldsJson(fields.formFields),
        opensAt: toDate(fields.opensAt),
        closesAt: toDate(fields.closesAt),
        selfCancelUntil: toDate(fields.selfCancelUntil),
      };
    });
  }

  async replaceOptions(user: AuthUser, id: string, dto: ReplaceOptionsDto): Promise<FullListing> {
    return this.mutate(user, id, dto.revision, async (tx, listing) => {
      const withOrders = await tx.orderItem.findMany({
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
      await tx.listingOption.deleteMany({
        where: { listingId: id, id: { notIn: dto.options.flatMap((o) => (o.id ? [o.id] : [])) } },
      });
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
  }

  async replacePickupPoints(user: AuthUser, id: string, dto: ReplacePickupPointsDto): Promise<FullListing> {
    try {
      return await this.mutate(user, id, dto.revision, async (tx, listing) => {
        const existing = new Map(listing.pickupPoints.map((p) => [p.id, p]));
        for (const p of dto.pickupPoints) {
          if (p.id && !existing.has(p.id)) {
            throw new AppError('VALIDATION_FAILED', 'Validation failed', [`pickupPoints: unknown pickup point ${p.id}`]);
          }
        }
        const kept = new Set(dto.pickupPoints.flatMap((p) => (p.id ? [p.id] : [])));
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
        // A point any order uses cannot go: the RESTRICT foreign key rejects it (mapped below), race-free.
        await tx.pickupPoint.deleteMany({ where: { listingId: id, id: { notIn: [...kept] } } });
        for (const p of dto.pickupPoints) {
          if (p.id) await tx.pickupPoint.update({ where: { id: p.id }, data: toData(p) });
        }
        await tx.pickupPoint.createMany({
          data: dto.pickupPoints.filter((p) => !p.id).map((p) => ({ ...toData(p), listingId: id })),
        });
        if (!moved.size) return;
        // DESIGN §5b: buyers who chose a moved point are told the new address, in their language (outbox.job).
        const orders = await tx.order.findMany({
          where: { pickupPointId: { in: [...moved.keys()] } },
          select: { id: true, buyerEmail: true, pickupPointId: true, locale: true },
        });
        await this.notifications.enqueue(
          tx,
          ...orders.map((o) => {
            const point = moved.get(o.pickupPointId!)!;
            return {
              type: 'PICKUP_POINT_CHANGED',
              recipient: o.buyerEmail,
              locale: o.locale,
              payload: { label: point.label, address: point.address } satisfies PickupPointChangedPayload,
              dedupeKey: `PICKUP_POINT_CHANGED:${o.id}:${point.address}`,
            };
          }),
        );
      });
    } catch (e) {
      if (isForeignKeyViolation(e)) throw new AppError('PICKUP_POINT_HAS_ORDERS', 'Orders use this pickup point');
      throw e;
    }
  }

  publish(user: AuthUser, id: string): Promise<FullListing> {
    return this.mutate(user, id, undefined, async (tx, listing) => {
      // Checked before the publish rules, so a wrong state reports as such rather than as missing fields.
      assertListingTransition(listing.status, 'PUBLISHED');
      await this.assertPublishable(tx, listing, listing.closesAt);
      const selfCancelUntil =
        listing.allowSelfCancel && !listing.selfCancelUntil
          ? defaultSelfCancelUntil(listing.options.filter((o) => o.active).map((o) => o.startsAt))
          : listing.selfCancelUntil;
      return { status: 'PUBLISHED', publishedAt: new Date(), selfCancelUntil };
    });
  }

  close(user: AuthUser, id: string): Promise<FullListing> {
    return this.mutate(user, id, undefined, async (_tx, listing) => {
      assertListingTransition(listing.status, 'CLOSED');
      return { status: 'CLOSED', closedAt: new Date() };
    });
  }

  /** CLOSED → PUBLISHED only; the same checks as publishing apply again (the merchant may have changed). */
  reopen(user: AuthUser, id: string, closesAtRaw?: string): Promise<FullListing> {
    return this.mutate(user, id, undefined, async (tx, listing) => {
      if (listing.status !== 'CLOSED') {
        throw new AppError('INVALID_STATE_TRANSITION', 'Only a closed listing can be reopened', { from: listing.status });
      }
      const closesAt = closesAtRaw ? new Date(closesAtRaw) : listing.closesAt;
      // Reopening into a past deadline would be closed again by the next job tick.
      if (closesAt && closesAt <= new Date()) throw new AppError('VALIDATION_FAILED', 'Validation failed', ['closesAt']);
      await this.assertPublishable(tx, listing, closesAt);
      return { status: 'PUBLISHED', closesAt, closedAt: null };
    });
  }

  /**
   * The one write path for an existing listing: locks its row (edits, publishing and the close job on one
   * listing run one at a time), rejects an edit based on an older revision, validates against the locked
   * state, then applies the change and bumps the revision.
   */
  private async mutate(
    user: AuthUser,
    id: string,
    expectedRevision: number | undefined,
    change: (tx: Prisma.TransactionClient, listing: FullListing) => Promise<Prisma.ListingUpdateInput | void>,
  ): Promise<FullListing> {
    const merchantId = requireMerchantId(user);
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM listing WHERE id = ${id}::uuid AND merchant_id = ${merchantId}::uuid FOR UPDATE`;
      if (!locked.length) throw new AppError('NOT_FOUND', 'Listing not found');
      const listing = await tx.listing.findUniqueOrThrow({ where: { id }, include: withChildren });
      if (expectedRevision !== undefined && expectedRevision !== listing.revision) {
        throw new AppError('LISTING_STALE', 'The listing changed meanwhile; reload', { revision: listing.revision });
      }
      const data = (await change(tx, listing)) ?? {};
      return tx.listing.update({
        where: { id },
        data: { ...data, revision: { increment: 1 } },
        include: withChildren,
      });
    });
  }

  private async assertPublishable(tx: Prisma.TransactionClient, listing: FullListing, closesAt: Date | null) {
    const merchant = await tx.merchant.findUniqueOrThrow({ where: { id: listing.merchantId } });
    validatePublishable({
      listing: { ...listing, closesAt },
      options: listing.options,
      pickupPointCount: listing.pickupPoints.length,
      merchant,
      now: new Date(),
    });
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
