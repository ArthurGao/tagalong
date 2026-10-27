const nzd = new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' });

// Money is integer NZD cents, GST-inclusive (DESIGN D8). Display only; never compute totals here.
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error(`Money must be integer cents, got ${cents}`);
  return nzd.format(cents / 100);
}
