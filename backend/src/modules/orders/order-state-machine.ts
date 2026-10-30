import type { Prisma } from '../../generated/prisma/client.js';
import type { OrderStatus } from '../../generated/prisma/enums.js';
import { AppError } from '../../common/errors/app-error.js';

// DESIGN §6. Paid orders never become CONFIRMED; free orders never PAID, REFUNDED or PARTIALLY_REFUNDED.
const PAID: Partial<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_PAYMENT: ['PAID', 'EXPIRED', 'CANCELLED'],
  // EXPIRED → PAID: a payment that lands just after expiry, when stock can be reserved again (§7.5).
  EXPIRED: ['PAID'],
  PAID: ['FULFILLED', 'REFUNDED', 'PARTIALLY_REFUNDED'],
  PARTIALLY_REFUNDED: ['REFUNDED', 'FULFILLED'],
  FULFILLED: ['REFUNDED', 'PARTIALLY_REFUNDED'],
};
const FREE: Partial<Record<OrderStatus, readonly OrderStatus[]>> = {
  CONFIRMED: ['FULFILLED', 'CANCELLED', 'NO_SHOW'],
};

/** An order that ended without being paid; a payment that still lands is handled late (DESIGN §7.5). */
export const ENDED_UNPAID: readonly OrderStatus[] = ['EXPIRED', 'CANCELLED'];

export function canTransition(isFree: boolean, from: OrderStatus, to: OrderStatus): boolean {
  return ((isFree ? FREE : PAID)[from] ?? []).includes(to);
}

export function assertTransition(isFree: boolean, from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(isFree, from, to)) {
    throw new AppError('INVALID_STATE_TRANSITION', `Order cannot go from ${from} to ${to}`, { from, to });
  }
}

/**
 * The only way an order's status changes (root CLAUDE.md rule 5): validates the transition, then a conditional
 * UPDATE on the expected current status, so a concurrent change makes it fail instead of overwriting.
 */
export async function transitionOrder(
  tx: Prisma.TransactionClient,
  order: { id: string; isFree: boolean; status: OrderStatus },
  to: OrderStatus,
  data: Omit<Prisma.OrderUpdateManyMutationInput, 'status'> = {},
): Promise<void> {
  assertTransition(order.isFree, order.status, to);
  const { count } = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { ...data, status: to } });
  if (count !== 1) {
    throw new AppError('INVALID_STATE_TRANSITION', `Order ${order.id} is no longer ${order.status}`, { from: order.status, to });
  }
}
