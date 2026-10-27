import { refundRetryAt } from './refund-processor.js';

describe('refund retry schedule (DESIGN §8.5: exponential backoff)', () => {
  it('waits 1, 2, 4, 8 minutes after attempts 1–4', () => {
    const now = new Date('2026-10-28T00:00:00Z');
    expect([1, 2, 3, 4].map((a) => (refundRetryAt(a, now).getTime() - now.getTime()) / 60_000)).toEqual([1, 2, 4, 8]);
  });
});
