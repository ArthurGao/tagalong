import type { ListingStatus } from '../../generated/prisma/enums.js';
import { assertListingTransition } from './listing-state-machine.js';

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
