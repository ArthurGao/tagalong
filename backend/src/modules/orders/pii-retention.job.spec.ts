import { retentionCutoff } from './pii-retention.job.js';

describe('retentionCutoff (DESIGN §10: 12 months)', () => {
  it.each([
    ['2027-11-01T03:30:00.000Z', '2026-11-01T03:30:00.000Z'],
    ['2027-03-31T00:00:00.000Z', '2026-03-31T00:00:00.000Z'],
    ['2028-02-29T12:00:00.000Z', '2027-02-28T12:00:00.000Z'],
  ])('%s → %s', (now, cutoff) => {
    expect(retentionCutoff(new Date(now)).toISOString()).toBe(cutoff);
  });
});
