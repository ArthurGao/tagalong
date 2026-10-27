import { describe, expect, it } from 'vitest';
import { formatNzDateTime } from './time';

describe('formatNzDateTime', () => {
  it('shows NZDT (UTC+13) in summer', () => {
    expect(formatNzDateTime('2026-01-15T00:00:00Z', 'en')).toContain('13:00');
  });

  it('shows NZST (UTC+12) in winter', () => {
    expect(formatNzDateTime('2026-07-15T00:00:00Z', 'en')).toContain('12:00');
  });

  it('rolls the date over to the NZ calendar day', () => {
    // 11:30 UTC on 14 Jan is 00:30 on 15 Jan in Auckland.
    expect(formatNzDateTime(new Date('2026-01-14T11:30:00Z'), 'en')).toMatch(/15 Jan 2026/);
  });
});
