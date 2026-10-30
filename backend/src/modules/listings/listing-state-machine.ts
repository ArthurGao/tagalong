import { AppError } from '../../common/errors/app-error.js';
import type { ListingStatus } from '../../generated/prisma/enums.js';
import { isTakenDown } from './availability.js';

// DESIGN §5b. Every listing status change goes through here.
const ALLOWED: Record<ListingStatus, readonly ListingStatus[]> = {
  DRAFT: ['PUBLISHED'],
  PUBLISHED: ['CLOSED', 'CANCELLED'],
  CLOSED: ['PUBLISHED', 'CANCELLED'],
  CANCELLED: [],
};

export function canListingTransition(from: ListingStatus, to: ListingStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertListingTransition(from: ListingStatus, to: ListingStatus): void {
  if (!canListingTransition(from, to)) {
    throw new AppError('INVALID_STATE_TRANSITION', `Listing cannot go from ${from} to ${to}`, { from, to });
  }
}

/**
 * The admin's one way back out of CANCELLED (DESIGN §9 restore): a takedown that refunded and cancelled nothing returns
 * to CLOSED. A merchant's own cancellation, or a takedown with refunds, is final.
 */
export function canRestoreListing(l: { status: ListingStatus; takenDownAt: Date | null; cancellation: { refundAll: boolean } | null }): boolean {
  return isTakenDown(l) && l.cancellation !== null && !l.cancellation.refundAll;
}

export function assertListingRestorable(l: Parameters<typeof canRestoreListing>[0]): void {
  if (!canRestoreListing(l)) {
    throw new AppError('INVALID_STATE_TRANSITION', 'Only a takedown without refunds or cancellations can be restored', { from: l.status, to: 'CLOSED' });
  }
}
