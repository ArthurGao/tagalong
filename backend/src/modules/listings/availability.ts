import { AppError } from '../../common/errors/app-error.js';
import type { ErrorCode } from '../../common/errors/error-codes.js';
import type { ListingStatus, MerchantStatus } from '../../generated/prisma/enums.js';

export const AVAILABILITY = ['OPEN', 'NOT_YET_OPEN', 'CLOSED', 'CANCELLED', 'TAKEN_DOWN', 'SUSPENDED', 'SOLD_OUT'] as const;
export type Availability = (typeof AVAILABILITY)[number];

export interface AvailabilityInput {
  status: ListingStatus;
  takenDownAt: Date | null;
  opensAt: Date | null;
  closesAt: Date | null;
  merchantStatus: MerchantStatus;
  /** Listing-wide places left, or null without a totalCapacity. */
  totalRemaining: number | null;
  /** Places left per active option; null = unlimited. */
  optionRemaining: (number | null)[];
}

/** An admin takedown is a CANCELLED listing with `takenDownAt` set (DESIGN §5b); its content is never public. */
export const isTakenDown = (l: { status: ListingStatus; takenDownAt: Date | null }) =>
  l.status === 'CANCELLED' && l.takenDownAt !== null;

/**
 * What the public page shows and whether ordering is possible, decided once on the server so the page never
 * combines status flags itself. The deadline is checked here too: the close job runs once a minute.
 */
export function listingAvailability(l: AvailabilityInput, now: Date): Availability {
  if (isTakenDown(l)) return 'TAKEN_DOWN';
  if (l.status === 'CANCELLED') return 'CANCELLED';
  if (l.merchantStatus === 'SUSPENDED') return 'SUSPENDED';
  if (l.status === 'CLOSED' || (l.closesAt && l.closesAt <= now)) return 'CLOSED';
  if (l.opensAt && l.opensAt > now) return 'NOT_YET_OPEN';
  const optionLeft = l.optionRemaining.some((r) => r === null || r > 0);
  if (!optionLeft || l.totalRemaining === 0) return 'SOLD_OUT';
  return 'OPEN';
}

/** Places left for a capacity (null = unlimited). */
export const remainingPlaces = (capacity: number | null, sold: number, reserved: number) =>
  capacity === null ? null : Math.max(0, capacity - sold - reserved);

interface Counted {
  capacity: number | null;
  soldCount: number;
  reservedCount: number;
}

/** Availability straight from a listing row with its options and merchant: the public page and ordering share it. */
export function availabilityOf(
  l: Omit<AvailabilityInput, 'merchantStatus' | 'totalRemaining' | 'optionRemaining'> & {
    totalCapacity: number | null;
    soldCount: number;
    reservedCount: number;
    merchant: { status: MerchantStatus };
    options: (Counted & { active: boolean })[];
  },
  now: Date,
): Availability {
  return listingAvailability(
    {
      ...l,
      merchantStatus: l.merchant.status,
      totalRemaining: remainingPlaces(l.totalCapacity, l.soldCount, l.reservedCount),
      optionRemaining: l.options.filter((o) => o.active).map((o) => remainingPlaces(o.capacity, o.soldCount, o.reservedCount)),
    },
    now,
  );
}

// Why an order is refused, per state (DESIGN §17). Exhaustive: a new availability must choose its code here.
const NOT_ORDERABLE: Record<Exclude<Availability, 'OPEN'>, ErrorCode> = {
  NOT_YET_OPEN: 'LISTING_NOT_PUBLISHED',
  CLOSED: 'LISTING_CLOSED',
  CANCELLED: 'LISTING_CLOSED',
  TAKEN_DOWN: 'LISTING_CLOSED',
  SUSPENDED: 'MERCHANT_SUSPENDED',
  SOLD_OUT: 'SOLD_OUT',
};

export function assertOrderable(availability: Availability): void {
  if (availability !== 'OPEN') throw new AppError(NOT_ORDERABLE[availability], `Listing is ${availability}`);
}
