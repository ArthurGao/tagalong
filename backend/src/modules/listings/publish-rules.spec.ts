import { applyListingDefaults, validateListingPatch, validateOptionsReplace, validatePublishable } from './publish-rules.js';
import type { FormField } from './form-fields.js';

const published = {
  status: 'PUBLISHED' as const,
  pricing: 'PAID' as const,
  type: 'RETAIL' as const,
  fulfilment: 'PICKUP' as const,
  soldCount: 6,
  reservedCount: 2,
  formFields: [] as FormField[],
};
const draft = { ...published, status: 'DRAFT' as const, soldCount: 0, reservedCount: 0 };
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code: string }).code;
  }
  return 'OK';
};

describe('validateListingPatch (DESIGN §5b)', () => {
  it.each(['pricing', 'type', 'fulfilment'] as const)('locks %s after publish', (field) => {
    const value = { pricing: 'FREE', type: 'EVENT', fulfilment: 'ONSITE' }[field];
    expect(code(() => validateListingPatch(published, { [field]: value }, { hasOrders: false }))).toBe(
      'FIELD_LOCKED_AFTER_PUBLISH',
    );
    expect(code(() => validateListingPatch(draft, { [field]: value }, { hasOrders: false }))).toBe('OK');
  });

  it('allows re-sending a locked field with its current value', () => {
    expect(code(() => validateListingPatch(published, { pricing: 'PAID' }, { hasOrders: false }))).toBe('OK');
  });

  it('keeps totalCapacity at or above sold + reserved', () => {
    expect(code(() => validateListingPatch(published, { totalCapacity: 7 }, { hasOrders: true }))).toBe('CAPACITY_BELOW_SOLD');
    expect(code(() => validateListingPatch(published, { totalCapacity: 8 }, { hasOrders: true }))).toBe('OK');
    expect(code(() => validateListingPatch(published, { totalCapacity: null }, { hasOrders: true }))).toBe('OK');
  });

  it('once there are orders, formFields may only gain optional fields', () => {
    const age: FormField = { key: 'age', label: 'Age', type: 'number', required: true, scope: 'attendee' };
    const withAge = { ...published, formFields: [age] };
    const optional: FormField = { key: 'note', label: 'Note', type: 'text', required: false, scope: 'order' };
    const required: FormField = { ...optional, required: true };
    expect(code(() => validateListingPatch(withAge, { formFields: [age, optional] }, { hasOrders: true }))).toBe('OK');
    expect(code(() => validateListingPatch(withAge, { formFields: [age, required] }, { hasOrders: true }))).toBe(
      'FIELD_LOCKED_AFTER_PUBLISH',
    );
    expect(code(() => validateListingPatch(withAge, { formFields: [optional] }, { hasOrders: true }))).toBe(
      'FIELD_LOCKED_AFTER_PUBLISH',
    );
    expect(
      code(() => validateListingPatch(withAge, { formFields: [{ ...age, label: 'Child age' }] }, { hasOrders: true })),
    ).toBe('FIELD_LOCKED_AFTER_PUBLISH');
    expect(code(() => validateListingPatch(withAge, { formFields: [optional] }, { hasOrders: false }))).toBe('OK');
  });

  it('caps maxQtyPerOrder at 10 for free listings', () => {
    const free = { ...draft, pricing: 'FREE' as const };
    expect(code(() => validateListingPatch(free, { maxQtyPerOrder: 11 }, { hasOrders: false }))).toBe('VALIDATION_FAILED');
    expect(code(() => validateListingPatch(free, { maxQtyPerOrder: 10 }, { hasOrders: false }))).toBe('OK');
  });
});

describe('validateOptionsReplace', () => {
  const existing = [
    { id: 'o1', priceCents: 3900, soldCount: 3, reservedCount: 1, hasOrders: true },
    { id: 'o2', priceCents: 8900, soldCount: 0, reservedCount: 0, hasOrders: false },
  ];
  const keep = (over: Record<string, unknown> = {}) => ({ id: 'o1', priceCents: 3900, capacity: 10, active: true, ...over });

  it('rejects capacity below sold + reserved', () => {
    expect(code(() => validateOptionsReplace('PAID', existing, [keep({ capacity: 3 })]))).toBe('CAPACITY_BELOW_SOLD');
    expect(code(() => validateOptionsReplace('PAID', existing, [keep({ capacity: 4 })]))).toBe('OK');
  });

  it('refuses to delete an option that has orders, but allows deactivating it', () => {
    expect(code(() => validateOptionsReplace('PAID', existing, [{ id: 'o2', priceCents: 8900, capacity: null, active: true }]))).toBe(
      'OPTION_HAS_ORDERS',
    );
    expect(code(() => validateOptionsReplace('PAID', existing, [keep({ active: false })]))).toBe('OK');
  });

  it('enforces D11 price ranges', () => {
    expect(code(() => validateOptionsReplace('PAID', [], [{ priceCents: 99, capacity: null, active: true }]))).toBe('PRICE_OUT_OF_RANGE');
    expect(code(() => validateOptionsReplace('PAID', [], [{ priceCents: 2_000_001, capacity: null, active: true }]))).toBe(
      'PRICE_OUT_OF_RANGE',
    );
    expect(code(() => validateOptionsReplace('PAID', [], [{ priceCents: 100, capacity: null, active: true }]))).toBe('OK');
    expect(code(() => validateOptionsReplace('FREE', [], [{ priceCents: 100, capacity: null, active: true }]))).toBe('PRICE_OUT_OF_RANGE');
    expect(code(() => validateOptionsReplace('FREE', [], [{ priceCents: 0, capacity: null, active: true }]))).toBe('OK');
  });

  it('rejects a session that does not end after it starts', () => {
    const at = (iso: string) => new Date(iso);
    const session = (startsAt: Date | null, endsAt: Date | null) => [{ priceCents: 0, capacity: null, active: true, startsAt, endsAt }];
    expect(code(() => validateOptionsReplace('FREE', [], session(at('2026-11-01T01:00:00Z'), at('2026-11-01T00:00:00Z'))))).toBe('VALIDATION_FAILED');
    expect(code(() => validateOptionsReplace('FREE', [], session(at('2026-11-01T01:00:00Z'), at('2026-11-01T01:00:00Z'))))).toBe('VALIDATION_FAILED');
    expect(code(() => validateOptionsReplace('FREE', [], session(at('2026-11-01T01:00:00Z'), at('2026-11-01T02:00:00Z'))))).toBe('OK');
    expect(code(() => validateOptionsReplace('FREE', [], session(at('2026-11-01T01:00:00Z'), null)))).toBe('OK');
  });

  it('rejects ids that are not options of this listing', () => {
    expect(code(() => validateOptionsReplace('PAID', existing, [keep({ id: 'other' })]))).toBe('VALIDATION_FAILED');
  });

  it('reports price changes so they can be audited', () => {
    expect(validateOptionsReplace('PAID', existing, [keep({ priceCents: 4200 }), { id: 'o2', priceCents: 8900, capacity: null, active: true }])).toEqual({
      priceChanges: [{ optionId: 'o1', fromCents: 3900, toCents: 4200 }],
    });
  });
});

describe('validatePublishable (D11, D12)', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  const ok = {
    listing: { pricing: 'PAID' as const, type: 'RETAIL' as const, fulfilment: 'PICKUP' as const, title: 'Cherries', policyText: 'No refunds', closesAt: new Date('2026-11-10T00:00:00Z') },
    options: [{ priceCents: 3900, active: true, startsAt: null }],
    pickupPointCount: 1,
    merchant: { status: 'ACTIVE' as const, chargesEnabled: true },
    now,
  };

  it('passes a complete paid listing from a chargeable merchant', () => {
    expect(code(() => validatePublishable(ok))).toBe('OK');
  });

  it('blocks suspended merchants and paid listings without Stripe charges', () => {
    expect(code(() => validatePublishable({ ...ok, merchant: { status: 'SUSPENDED', chargesEnabled: true } }))).toBe('MERCHANT_SUSPENDED');
    expect(code(() => validatePublishable({ ...ok, merchant: { status: 'ACTIVE', chargesEnabled: false } }))).toBe('MERCHANT_NOT_CHARGEABLE');
  });

  it('lets a free listing publish without Stripe (D12)', () => {
    const free = { ...ok, listing: { ...ok.listing, pricing: 'FREE' as const }, options: [{ priceCents: 0, active: true, startsAt: null }] };
    expect(code(() => validatePublishable({ ...free, merchant: { status: 'ACTIVE', chargesEnabled: false } }))).toBe('OK');
  });

  it('lists every missing piece as VALIDATION_FAILED details', () => {
    try {
      validatePublishable({
        ...ok,
        listing: { ...ok.listing, type: 'EVENT', title: ' ', policyText: '', closesAt: new Date('2026-10-01T00:00:00Z') },
        options: [{ priceCents: 3900, active: false, startsAt: null }],
        pickupPointCount: 0,
      });
      throw new Error('expected failure');
    } catch (e) {
      expect(e).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect((e as { details: string[] }).details.sort()).toEqual(['closesAt', 'options', 'pickupPoints', 'policyText', 'title']);
    }
  });

  it('requires start times on session and event options', () => {
    const event = { ...ok, listing: { ...ok.listing, type: 'EVENT' as const, fulfilment: 'ONSITE' as const }, pickupPointCount: 0 };
    expect(code(() => validatePublishable(event))).toBe('VALIDATION_FAILED');
    expect(code(() => validatePublishable({ ...event, options: [{ priceCents: 3900, active: true, startsAt: new Date('2026-11-12T00:00:00Z') }] }))).toBe('OK');
  });
});

describe('applyListingDefaults (DESIGN §5.1)', () => {
  it('free listings: one per email, self-cancel on, one place per order', () => {
    expect(applyListingDefaults('EVENT', 'FREE')).toEqual({ onePerEmail: true, allowSelfCancel: true, maxQtyPerOrder: 1, remindBeforeHours: 24 });
  });

  it('paid retail: no self-cancel, up to 10 per order, no reminder', () => {
    expect(applyListingDefaults('RETAIL', 'PAID')).toEqual({ onePerEmail: false, allowSelfCancel: false, maxQtyPerOrder: 10, remindBeforeHours: null });
  });
});
