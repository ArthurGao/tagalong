import { shareInfo } from './share-info.js';

const option = (over: Partial<Parameters<typeof shareInfo>[0]['options'][number]> = {}) => ({
  active: true, priceCents: 3900, capacity: 10, soldCount: 3, reservedCount: 1, startsAt: null, location: null, ...over,
});
const listing = (over: Partial<Parameters<typeof shareInfo>[0]> = {}) => ({
  totalCapacity: null, soldCount: 0, reservedCount: 0, options: [option()], pickupPoints: [], ...over,
});

describe('share info (DESIGN §11 share text)', () => {
  it('quotes the price range and the places left over active options', () => {
    const info = shareInfo(listing({ options: [option(), option({ priceCents: 5900 }), option({ priceCents: 100, active: false })] }));
    expect(info).toMatchObject({ minPriceCents: 3900, maxPriceCents: 5900, remaining: 12 });
  });

  it('has no count when any option is unlimited; otherwise the lower of the listing cap and the options', () => {
    expect(shareInfo(listing({ options: [option(), option({ capacity: null })] })).remaining).toBeNull();
    expect(shareInfo(listing({ totalCapacity: 5, soldCount: 3, reservedCount: 0 })).remaining).toBe(2);
    expect(shareInfo(listing({ totalCapacity: 50, options: [option({ capacity: null })] })).remaining).toBe(50);
    expect(shareInfo(listing({ totalCapacity: 50 })).remaining).toBe(6); // the options' places run out first
  });

  it('names the first pickup point, else the first session place, and the first session time', () => {
    const later = new Date('2026-11-10T00:00:00Z');
    const sooner = new Date('2026-11-07T00:00:00Z');
    const sessions = [option({ startsAt: later, location: 'Hall B' }), option({ startsAt: sooner, location: 'Hall A' })];
    expect(shareInfo(listing({ options: sessions }))).toMatchObject({ place: 'Hall A', startsAt: sooner });
    const pickups = [{ label: 'Takapuna', createdAt: later }, { label: 'Albany', createdAt: sooner }];
    expect(shareInfo(listing({ pickupPoints: pickups })).place).toBe('Albany');
    expect(shareInfo(listing({ options: [] }))).toMatchObject({ minPriceCents: null, place: null, startsAt: null });
  });
});
