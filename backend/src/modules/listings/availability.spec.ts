import { type AvailabilityInput, listingAvailability } from './availability.js';

const now = new Date('2026-11-01T00:00:00Z');
const open: AvailabilityInput = {
  status: 'PUBLISHED',
  takenDownAt: null,
  opensAt: null,
  closesAt: new Date('2026-11-05T00:00:00Z'),
  merchantStatus: 'ACTIVE',
  totalRemaining: null,
  optionRemaining: [5, null],
};
const at = (over: Partial<AvailabilityInput>) => listingAvailability({ ...open, ...over }, now);

describe('listingAvailability', () => {
  it('is OPEN for a published listing with places left', () => {
    expect(at({})).toBe('OPEN');
  });

  it('cancelled vs taken down by an admin', () => {
    expect(at({ status: 'CANCELLED' })).toBe('CANCELLED');
    expect(at({ status: 'CANCELLED', takenDownAt: now })).toBe('TAKEN_DOWN');
  });

  it('a suspended merchant pauses every listing (DESIGN §10)', () => {
    expect(at({ merchantStatus: 'SUSPENDED' })).toBe('SUSPENDED');
    expect(at({ merchantStatus: 'SUSPENDED', status: 'CANCELLED', takenDownAt: now })).toBe('TAKEN_DOWN');
  });

  it('closed by status or by a passed deadline the job has not reached yet', () => {
    expect(at({ status: 'CLOSED' })).toBe('CLOSED');
    expect(at({ closesAt: new Date('2026-10-31T23:59:59Z') })).toBe('CLOSED');
  });

  it('not yet open before opensAt', () => {
    expect(at({ opensAt: new Date('2026-11-02T00:00:00Z') })).toBe('NOT_YET_OPEN');
  });

  it('sold out when no option has places, or the listing-wide capacity is used up', () => {
    expect(at({ optionRemaining: [0, 0] })).toBe('SOLD_OUT');
    expect(at({ optionRemaining: [] })).toBe('SOLD_OUT');
    expect(at({ totalRemaining: 0 })).toBe('SOLD_OUT');
    expect(at({ optionRemaining: [0, null] })).toBe('OPEN');
  });
});
