import { AppError } from '../../common/errors/app-error.js';
import type { Fulfilment, ListingStatus, ListingType, MerchantStatus, Pricing } from '../../generated/prisma/enums.js';
import type { FormField } from './form-fields.js';

// DESIGN §5b (what may change after publishing), D11 (pricing per listing), D12 (publish gate).

export const PAID_MIN_CENTS = 100; // $1.00, Stripe's NZD minimum with headroom
export const PAID_MAX_CENTS = 2_000_000; // $20,000
const FREE_MAX_QTY = 10;
const PAID_MAX_QTY = 50;

const LOCKED_AFTER_PUBLISH = ['pricing', 'type', 'fulfilment'] as const;

interface ListingForPatch {
  status: ListingStatus;
  pricing: Pricing;
  type: ListingType;
  fulfilment: Fulfilment;
  soldCount: number;
  reservedCount: number;
  formFields: FormField[];
}

export interface ListingPatchRuleInput {
  pricing?: Pricing;
  type?: ListingType;
  fulfilment?: Fulfilment;
  totalCapacity?: number | null;
  formFields?: FormField[];
  maxQtyPerOrder?: number;
}

const sameField = (a: FormField, b: FormField) => JSON.stringify(a) === JSON.stringify(b);

export function validateListingPatch(
  listing: ListingForPatch,
  patch: ListingPatchRuleInput,
  { hasOrders }: { hasOrders: boolean },
): void {
  if (listing.status !== 'DRAFT') {
    for (const field of LOCKED_AFTER_PUBLISH) {
      if (patch[field] !== undefined && patch[field] !== listing[field]) {
        throw new AppError('FIELD_LOCKED_AFTER_PUBLISH', `${field} cannot change after publishing`, { field });
      }
    }
  }
  if (patch.totalCapacity != null && patch.totalCapacity < listing.soldCount + listing.reservedCount) {
    throw new AppError('CAPACITY_BELOW_SOLD', 'Capacity is below what is sold or reserved', {
      minimum: listing.soldCount + listing.reservedCount,
    });
  }
  // Existing answers must stay complete: keep every field as it was, add only optional ones.
  if (hasOrders && patch.formFields) {
    const next = new Map(patch.formFields.map((f) => [f.key, f]));
    const kept = listing.formFields.every((f) => next.has(f.key) && sameField(f, next.get(f.key)!));
    const known = new Set(listing.formFields.map((f) => f.key));
    const addedRequired = patch.formFields.some((f) => !known.has(f.key) && f.required);
    if (!kept || addedRequired) {
      throw new AppError('FIELD_LOCKED_AFTER_PUBLISH', 'With orders, form fields can only gain optional fields', {
        field: 'formFields',
      });
    }
  }
  const pricing = patch.pricing ?? listing.pricing;
  const maxQty = pricing === 'FREE' ? FREE_MAX_QTY : PAID_MAX_QTY;
  if (patch.maxQtyPerOrder !== undefined && patch.maxQtyPerOrder > maxQty) {
    throw new AppError('VALIDATION_FAILED', 'Validation failed', [`maxQtyPerOrder must be at most ${maxQty}`]);
  }
}

interface ExistingOption {
  id: string;
  priceCents: number;
  soldCount: number;
  reservedCount: number;
  hasOrders: boolean;
}

export interface OptionInput {
  id?: string;
  priceCents: number;
  capacity: number | null;
  active: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

export function assertPriceInRange(pricing: Pricing, priceCents: number): void {
  const ok = pricing === 'FREE' ? priceCents === 0 : priceCents >= PAID_MIN_CENTS && priceCents <= PAID_MAX_CENTS;
  if (!ok) {
    throw new AppError('PRICE_OUT_OF_RANGE', 'Price out of range', {
      pricing,
      priceCents,
      ...(pricing === 'PAID' ? { minCents: PAID_MIN_CENTS, maxCents: PAID_MAX_CENTS } : {}),
    });
  }
}

/** Full replacement of a listing's options; returns price changes to audit. */
export function validateOptionsReplace(
  pricing: Pricing,
  existing: ExistingOption[],
  next: OptionInput[],
): { priceChanges: { optionId: string; fromCents: number; toCents: number }[] } {
  const byId = new Map(existing.map((o) => [o.id, o]));
  const priceChanges: { optionId: string; fromCents: number; toCents: number }[] = [];
  for (const [i, option] of next.entries()) {
    assertPriceInRange(pricing, option.priceCents);
    // A session that ends before it starts would reach calendars upside down.
    if (option.startsAt && option.endsAt && option.endsAt <= option.startsAt) {
      throw new AppError('VALIDATION_FAILED', 'Validation failed', [`options.${i}.endsAt must be after startsAt`]);
    }
    if (!option.id) continue;
    const current = byId.get(option.id);
    if (!current) throw new AppError('VALIDATION_FAILED', 'Validation failed', [`options: unknown option ${option.id}`]);
    if (option.capacity !== null && option.capacity < current.soldCount + current.reservedCount) {
      throw new AppError('CAPACITY_BELOW_SOLD', 'Capacity is below what is sold or reserved', {
        optionId: option.id,
        minimum: current.soldCount + current.reservedCount,
      });
    }
    if (option.priceCents !== current.priceCents) {
      priceChanges.push({ optionId: option.id, fromCents: current.priceCents, toCents: option.priceCents });
    }
  }
  const kept = new Set(next.map((o) => o.id).filter(Boolean));
  const removedWithOrders = existing.find((o) => !kept.has(o.id) && o.hasOrders);
  if (removedWithOrders) {
    throw new AppError('OPTION_HAS_ORDERS', 'This option has orders; deactivate it instead', {
      optionId: removedWithOrders.id,
    });
  }
  return { priceChanges };
}

export interface PublishInput {
  listing: {
    pricing: Pricing;
    type: ListingType;
    fulfilment: Fulfilment;
    title: string;
    policyText: string;
    closesAt: Date | null;
  };
  options: { priceCents: number; active: boolean; startsAt: Date | null }[];
  pickupPointCount: number;
  merchant: { status: MerchantStatus; chargesEnabled: boolean };
  now: Date;
}

export function validatePublishable({ listing, options, pickupPointCount, merchant, now }: PublishInput): void {
  if (merchant.status === 'SUSPENDED') throw new AppError('MERCHANT_SUSPENDED', 'This merchant is suspended');
  if (listing.pricing === 'PAID' && !merchant.chargesEnabled) {
    throw new AppError('MERCHANT_NOT_CHARGEABLE', 'Finish Stripe onboarding before publishing a paid listing');
  }
  const active = options.filter((o) => o.active);
  for (const option of active) assertPriceInRange(listing.pricing, option.priceCents);

  const missing: string[] = [];
  if (!listing.title.trim()) missing.push('title');
  if (!listing.policyText.trim()) missing.push('policyText');
  if (active.length === 0) missing.push('options');
  else if (listing.type !== 'RETAIL' && active.some((o) => !o.startsAt)) missing.push('options.startsAt');
  if (listing.closesAt && listing.closesAt <= now) missing.push('closesAt');
  if (listing.fulfilment === 'PICKUP' && pickupPointCount === 0) missing.push('pickupPoints');
  if (missing.length) throw new AppError('VALIDATION_FAILED', 'Listing is not ready to publish', missing);
}

/** Defaults set when a listing is created (DESIGN §5.1). */
export function applyListingDefaults(type: ListingType, pricing: Pricing) {
  const free = pricing === 'FREE';
  return {
    onePerEmail: free,
    allowSelfCancel: free,
    maxQtyPerOrder: free ? 1 : 10,
    remindBeforeHours: type === 'RETAIL' ? null : 24,
  };
}

/** Default self-cancel deadline: 2 hours before the earliest session (DESIGN §5.1). */
export function defaultSelfCancelUntil(startTimes: (Date | null)[]): Date | null {
  const earliest = startTimes.filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime())[0];
  return earliest ? new Date(earliest.getTime() - 2 * 60 * 60 * 1000) : null;
}
