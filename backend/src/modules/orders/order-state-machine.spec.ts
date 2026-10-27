import { OrderStatus } from '../../generated/prisma/enums.js';
import { assertTransition, canTransition } from './order-state-machine.js';

const ALL = Object.values(OrderStatus);

// Every pair is checked: what is not listed here must be rejected.
const PAID_ALLOWED = [
  'PENDING_PAYMENT→PAID',
  'PENDING_PAYMENT→EXPIRED',
  'PENDING_PAYMENT→CANCELLED',
  'EXPIRED→PAID',
  'PAID→FULFILLED',
  'PAID→REFUNDED',
  'PAID→PARTIALLY_REFUNDED',
  'PARTIALLY_REFUNDED→REFUNDED',
  'PARTIALLY_REFUNDED→FULFILLED',
  'FULFILLED→REFUNDED',
  'FULFILLED→PARTIALLY_REFUNDED',
];
const FREE_ALLOWED = ['CONFIRMED→FULFILLED', 'CONFIRMED→CANCELLED', 'CONFIRMED→NO_SHOW'];

describe('order state machine (DESIGN §6)', () => {
  const pairs = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));

  it.each(pairs)('paid %s → %s', (from, to) => {
    expect(canTransition(false, from, to)).toBe(PAID_ALLOWED.includes(`${from}→${to}`));
  });

  it.each(pairs)('free %s → %s', (from, to) => {
    expect(canTransition(true, from, to)).toBe(FREE_ALLOWED.includes(`${from}→${to}`));
  });

  it('never lets a paid order be CONFIRMED or a free order be PAID / REFUNDED', () => {
    for (const from of ALL) {
      expect(canTransition(false, from, 'CONFIRMED')).toBe(false);
      for (const to of ['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'] as const) expect(canTransition(true, from, to)).toBe(false);
    }
  });

  it('throws INVALID_STATE_TRANSITION with the states in details', () => {
    expect(() => assertTransition(false, 'REFUNDED', 'PAID')).toThrow(
      expect.objectContaining({ code: 'INVALID_STATE_TRANSITION', details: { from: 'REFUNDED', to: 'PAID' } }),
    );
  });
});
