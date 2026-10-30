import type { components } from './api/schema';

type ListingStatus = components['schemas']['ListingStatus'];

/** The label key for a listing's status: a takedown is a CANCELLED listing shown as "taken down" (DESIGN §5b). */
export function listingStatusKey(l: { status: ListingStatus; takenDown: boolean }): ListingStatus | 'TAKEN_DOWN' {
  return l.takenDown ? 'TAKEN_DOWN' : l.status;
}
