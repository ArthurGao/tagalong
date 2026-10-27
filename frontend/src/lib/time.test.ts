import { describe, expect, it } from 'vitest';
import { formatNzDateTime, instantForInput, isoToNzInput, nzInputToIso } from './time';

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

describe('datetime-local inputs are Auckland wall-clock time', () => {
  it('converts NZDT (UTC+13) and NZST (UTC+12) input to UTC', () => {
    expect(nzInputToIso('2026-01-15T13:00')).toBe('2026-01-15T00:00:00.000Z');
    expect(nzInputToIso('2026-07-15T12:00')).toBe('2026-07-15T00:00:00.000Z');
  });

  it('formats UTC back to an Auckland input value', () => {
    expect(isoToNzInput('2026-01-15T00:00:00.000Z')).toBe('2026-01-15T13:00');
    expect(isoToNzInput('2026-07-15T00:00:00Z')).toBe('2026-07-15T12:00');
  });

  it('handles the day after DST ends (first Sunday of April) without drift', () => {
    expect(nzInputToIso('2026-04-06T09:00')).toBe('2026-04-05T21:00:00.000Z');
    expect(isoToNzInput(nzInputToIso('2026-04-06T09:00')!)).toBe('2026-04-06T09:00');
  });

  it('returns null for an empty input', () => {
    expect(nzInputToIso('')).toBeNull();
  });
});

describe('DST edges (Auckland: NZDT +13 ↔ NZST +12)', () => {
  it('rejects a wall time that does not exist (clocks jump 02:00 → 03:00 on 27 Sep 2026)', () => {
    expect(nzInputToIso('2026-09-27T02:30')).toBeNull();
    expect(nzInputToIso('2026-09-27T03:30')).toBe('2026-09-26T14:30:00.000Z');
  });

  it('resolves a repeated wall time (02:00–03:00 on 5 Apr 2026 happens twice) to the earlier instant', () => {
    expect(nzInputToIso('2026-04-05T02:30')).toBe('2026-04-04T13:30:00.000Z');
  });

  it('keeps an unchanged input at its original instant, even in the repeated hour', () => {
    const later = '2026-04-04T14:30:00.000Z'; // the second 02:30
    expect(isoToNzInput(later)).toBe('2026-04-05T02:30');
    expect(instantForInput(later, '2026-04-05T02:30')).toBe(later);
    expect(instantForInput(later, '2026-04-05T04:00')).toBe('2026-04-04T16:00:00.000Z');
    expect(instantForInput(null, '')).toBeNull();
  });
});
