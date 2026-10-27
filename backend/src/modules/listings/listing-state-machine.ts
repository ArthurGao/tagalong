import { AppError } from '../../common/errors/app-error.js';
import type { ListingStatus } from '../../generated/prisma/enums.js';

// DESIGN §5b. Every listing status change goes through here.
const ALLOWED: Record<ListingStatus, readonly ListingStatus[]> = {
  DRAFT: ['PUBLISHED'],
  PUBLISHED: ['CLOSED', 'CANCELLED'],
  CLOSED: ['PUBLISHED', 'CANCELLED'],
  CANCELLED: [],
};

export function assertListingTransition(from: ListingStatus, to: ListingStatus): void {
  if (!ALLOWED[from].includes(to)) {
    throw new AppError('INVALID_STATE_TRANSITION', `Listing cannot go from ${from} to ${to}`, { from, to });
  }
}
