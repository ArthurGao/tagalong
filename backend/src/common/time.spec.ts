import { aucklandDayStart } from './time.js';

describe('aucklandDayStart', () => {
  it('is local midnight in standard time (NZST, UTC+12)', () => {
    expect(aucklandDayStart(new Date('2026-07-15T03:00:00Z')).toISOString()).toBe('2026-07-14T12:00:00.000Z');
  });

  it('is local midnight in daylight time (NZDT, UTC+13), late in the UTC day too', () => {
    expect(aucklandDayStart(new Date('2026-11-07T20:30:00Z')).toISOString()).toBe('2026-11-07T11:00:00.000Z');
  });

  it('uses the offset at midnight on a day the clocks change later', () => {
    // Daylight time starts at 02:00 on Sunday 27 September 2026; that day began at 00:00 NZST.
    expect(aucklandDayStart(new Date('2026-09-27T05:00:00Z')).toISOString()).toBe('2026-09-26T12:00:00.000Z');
    // Daylight time ends at 03:00 on Sunday 5 April 2026; that day began at 00:00 NZDT.
    expect(aucklandDayStart(new Date('2026-04-05T06:00:00Z')).toISOString()).toBe('2026-04-04T11:00:00.000Z');
  });

  it('counts whole Auckland calendar days back, across a clock change', () => {
    // 1 Oct 2026 (NZDT) back 30 days is 1 Sep 2026, a standard-time midnight: 720 hours would land an hour early.
    expect(aucklandDayStart(new Date('2026-10-01T03:00:00Z'), 30).toISOString()).toBe('2026-08-31T12:00:00.000Z');
    // 20 Apr 2026 (NZST) back 30 days is 21 Mar 2026, a daylight-time midnight.
    expect(aucklandDayStart(new Date('2026-04-20T03:00:00Z'), 30).toISOString()).toBe('2026-03-20T11:00:00.000Z');
  });
});
