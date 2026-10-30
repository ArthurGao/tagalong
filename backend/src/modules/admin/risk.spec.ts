import { riskFlags, type RiskMetrics } from './risk.js';

const now = new Date('2026-11-10T00:00:00Z');
const quiet: RiskMetrics = {
  createdAt: new Date('2026-01-01T00:00:00Z'),
  paidCents90d: 100_000,
  refundedCents90d: 0,
  openDisputes: 0,
  todayCents: 0,
  previous30dCents: 30_000,
};

describe('risk flags (DESIGN §9)', () => {
  it('flags nothing for an established, quiet merchant', () => {
    expect(riskFlags(quiet, now)).toEqual([]);
  });

  it('flags a merchant created less than 7 days ago, not one exactly 7 days old', () => {
    expect(riskFlags({ ...quiet, createdAt: new Date(now.getTime() - 7 * 86_400_000 + 1) }, now)).toEqual(['NEW_MERCHANT']);
    expect(riskFlags({ ...quiet, createdAt: new Date(now.getTime() - 7 * 86_400_000) }, now)).toEqual([]);
  });

  it('flags a refund rate above 10%, not exactly 10%', () => {
    expect(riskFlags({ ...quiet, refundedCents90d: 10_001 }, now)).toEqual(['HIGH_REFUND_RATE']);
    expect(riskFlags({ ...quiet, refundedCents90d: 10_000 }, now)).toEqual([]);
    expect(riskFlags({ ...quiet, paidCents90d: 0 }, now)).toEqual([]);
  });

  it('flags an open dispute', () => {
    expect(riskFlags({ ...quiet, openDisputes: 1 }, now)).toEqual(['OPEN_DISPUTE']);
  });

  it("flags today's GMV above 5 times the 30-day daily average, not exactly 5 times", () => {
    // 30,000 over 30 days is 1,000 a day.
    expect(riskFlags({ ...quiet, todayCents: 5_001 }, now)).toEqual(['GMV_SPIKE']);
    expect(riskFlags({ ...quiet, todayCents: 5_000 }, now)).toEqual([]);
    expect(riskFlags({ ...quiet, previous30dCents: 0, todayCents: 1 }, now)).toEqual(['GMV_SPIKE']);
    expect(riskFlags({ ...quiet, previous30dCents: 0, todayCents: 0 }, now)).toEqual([]);
  });

  it('lists every flag that applies, in a fixed order', () => {
    expect(riskFlags({ createdAt: now, paidCents90d: 100, refundedCents90d: 50, openDisputes: 2, todayCents: 100, previous30dCents: 0 }, now)).toEqual([
      'NEW_MERCHANT',
      'HIGH_REFUND_RATE',
      'OPEN_DISPUTE',
      'GMV_SPIKE',
    ]);
  });
});
