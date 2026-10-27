const nzd = new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' });

// Money is integer NZD cents, GST-inclusive (DESIGN D8). Display only; never compute totals here.
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error(`Money must be integer cents, got ${cents}`);
  return nzd.format(cents / 100);
}

/** "39.5" → 3950. String arithmetic only: 0.29 * 100 is 28.999… in floating point. null when invalid. */
export function dollarsToCents(input: string): number | null {
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const dollars = Number(match[1].replace(/,/g, ''));
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  return dollars * 100 + cents;
}

/** 3950 → "39.50", for editing a price in an input. */
export function centsToDollarsInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
