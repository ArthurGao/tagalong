import type { components } from './api/schema';

type OrderStatus = components['schemas']['OrderStatus'];

/** The label key for an order's status: a fulfilled free registration reads "checked in", not "collected". */
export function statusKey(order: { isFree: boolean; status: OrderStatus }): OrderStatus | 'CHECKED_IN' {
  return order.isFree && order.status === 'FULFILLED' ? 'CHECKED_IN' : order.status;
}
