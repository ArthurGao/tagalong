import { describe, expect, it } from 'vitest';
import { formatCents } from './money';

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
