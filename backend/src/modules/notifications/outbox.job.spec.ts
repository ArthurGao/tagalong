import { nextAttemptAt } from './outbox.job.js';

describe('outbox retry schedule (DESIGN §12)', () => {
  const now = new Date('2026-10-27T00:00:00Z');
  const minutesLater = (attempts: number) => {
    const at = nextAttemptAt(attempts, now);
    return at && (at.getTime() - now.getTime()) / 60_000;
  };

  it('retries after 1, 5, 30 minutes, 2 hours and 12 hours, then gives up', () => {
    expect([1, 2, 3, 4, 5].map(minutesLater)).toEqual([1, 5, 30, 120, 720]);
    expect(nextAttemptAt(6, now)).toBeNull();
  });
});
