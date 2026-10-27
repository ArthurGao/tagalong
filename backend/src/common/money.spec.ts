import { formatCents, platformFee } from './money.js';

describe('platformFee (DESIGN §8.2)', () => {
  it.each([
    [3900, 300, 0, 117],
    [3950, 300, 0, 119], // 118.5 rounds half up
    [100, 300, 30, 33],
    [0, 300, 30, 0], // nothing to charge on a free order
    [50, 300, 100, 50], // capped at the subtotal
  ])('%i cents at %i bps + %i → %i', (subtotal, bps, fixed, fee) => {
    expect(platformFee(subtotal, bps, fixed)).toBe(fee);
  });

  it('rejects fractional or negative subtotals', () => {
    expect(() => platformFee(39.5, 300, 0)).toThrow();
    expect(() => platformFee(-1, 300, 0)).toThrow();
  });
});

describe('formatCents', () => {
  it('formats integer cents as NZD and refuses fractions', () => {
    expect(formatCents(3950)).toBe('$39.50');
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(() => formatCents(39.5)).toThrow();
  });
});
