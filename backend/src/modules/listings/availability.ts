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

/**
 * What the public page shows and whether ordering is possible, decided once on the server so the page never
 * combines status flags itself. The deadline is checked here too: the close job runs once a minute.
 */
export function listingAvailability(l: AvailabilityInput, now: Date): Availability {
  if (l.status === 'CANCELLED') return l.takenDownAt ? 'TAKEN_DOWN' : 'CANCELLED';
  if (l.merchantStatus === 'SUSPENDED') return 'SUSPENDED';
  if (l.status === 'CLOSED' || (l.closesAt && l.closesAt <= now)) return 'CLOSED';
  if (l.opensAt && l.opensAt > now) return 'NOT_YET_OPEN';
  const optionLeft = l.optionRemaining.some((r) => r === null || r > 0);
  if (!optionLeft || l.totalRemaining === 0) return 'SOLD_OUT';
  return 'OPEN';
}

/** Places left for a capacity (null = unlimited). Shared by the public page and, from M5, order creation. */
export const remainingPlaces = (capacity: number | null, sold: number, reserved: number) =>
  capacity === null ? null : Math.max(0, capacity - sold - reserved);
