import type { ListingStatus } from '../../generated/prisma/enums.js';
import { assertListingTransition, canRestoreListing } from './listing-state-machine.js';

const ALL: ListingStatus[] = ['DRAFT', 'PUBLISHED', 'CLOSED', 'CANCELLED'];
// DESIGN §5b
const ALLOWED = new Set(['DRAFT>PUBLISHED', 'PUBLISHED>CLOSED', 'CLOSED>PUBLISHED', 'PUBLISHED>CANCELLED', 'CLOSED>CANCELLED']);

describe('ListingStateMachine', () => {
  for (const from of ALL) {
    for (const to of ALL) {
      const key = `${from}>${to}`;
      if (ALLOWED.has(key)) {
        it(`allows ${key}`, () => expect(() => assertListingTransition(from, to)).not.toThrow());
      } else {
        it(`rejects ${key}`, () =>
          expect(() => assertListingTransition(from, to)).toThrow(
            expect.objectContaining({ code: 'INVALID_STATE_TRANSITION', httpStatus: 409 }),
          ));
      }
    }
  }
});

describe('restoring a takedown (DESIGN §9)', () => {
  const takenDown = { status: 'CANCELLED' as const, takenDownAt: new Date(), cancellation: { refundAll: false } };

  it('only a takedown that refunded and cancelled nothing', () => {
    expect(canRestoreListing(takenDown)).toBe(true);
    expect(canRestoreListing({ ...takenDown, cancellation: { refundAll: true } })).toBe(false);
    expect(canRestoreListing({ ...takenDown, takenDownAt: null })).toBe(false); // the merchant's own cancellation
    expect(canRestoreListing({ ...takenDown, cancellation: null })).toBe(false);
    expect(canRestoreListing({ ...takenDown, status: 'CLOSED' })).toBe(false);
  });
});
