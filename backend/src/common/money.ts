// Money is integer NZD cents, GST-inclusive (DESIGN D8). Never floats for stored amounts.

/** Platform fee on a subtotal (DESIGN §8.2): round(subtotal × bps / 10000) + fixed, never more than the subtotal. */
export function platformFee(subtotalCents: number, bps: number, fixedCents: number): number {
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) throw new Error(`Invalid subtotal ${subtotalCents}`);
  if (subtotalCents === 0) return 0;
  return Math.min(subtotalCents, Math.round((subtotalCents * bps) / 10_000) + fixedCents);
}

const nzd = new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' });

/** 3950 → "$39.50". Display only (emails); never feed the result back into arithmetic. */
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error(`Money must be integer cents, got ${cents}`);
  return nzd.format(cents / 100);
}
