import { describe, expect, it } from 'vitest';
import { centsToDollarsInput, dollarsToCents, formatCents } from './money';

describe('formatCents', () => {
  it('formats NZD cents with two decimals', () => {
    expect(formatCents(3900)).toBe('$39.00');
    expect(formatCents(5)).toBe('$0.05');
  });

  it('formats zero and large amounts with grouping', () => {
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(2_000_000)).toBe('$20,000.00');
  });

  it('formats negative amounts (refunds)', () => {
    expect(formatCents(-3900)).toBe('-$39.00');
  });

  it('rejects non-integer cents instead of rounding', () => {
    expect(() => formatCents(39.5)).toThrow('Money must be integer cents');
  });
});

describe('dollarsToCents (string arithmetic, never floats)', () => {
  it.each([
    ['39', 3900],
    ['39.5', 3950],
    ['39.50', 3950],
    ['0.29', 29],
    ['1,234.56', 123456],
    [' 20000 ', 2000000],
    ['0', 0],
  ])('%j → %i', (input, cents) => {
    expect(dollarsToCents(input)).toBe(cents);
  });

  it.each(['', '-1', '1.234', 'abc', '1.2.3', '$5'])('rejects %j', (input) => {
    expect(dollarsToCents(input)).toBeNull();
  });

  it('round-trips through centsToDollarsInput', () => {
    expect(centsToDollarsInput(3950)).toBe('39.50');
    expect(centsToDollarsInput(0)).toBe('0.00');
    expect(dollarsToCents(centsToDollarsInput(123456))).toBe(123456);
  });
});
