const nzd = new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' });

// Money is integer NZD cents, GST-inclusive (DESIGN D8). Display only; never compute totals here.
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error(`Money must be integer cents, got ${cents}`);
  return nzd.format(cents / 100);
}

/** Lowest and highest price, or null for none. The one rule for "from $x" and "$x – $y" labels. */
export function priceSpan(prices: number[]): { min: number; max: number } | null {
  return prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null;
}

/**
 * The price a listing shows: "free" for free listings (or no prices), "$39.00" for one price, "from $39.00" for a
 * range. Wording comes from the caller's message catalog.
 */
export function priceLabel(pricing: 'FREE' | 'PAID', prices: number[], words: { free: string; from: (price: string) => string }): string {
  const span = priceSpan(prices);
  if (pricing === 'FREE' || !span) return words.free;
  return span.min === span.max ? formatCents(span.min) : words.from(formatCents(span.min));
}

/** "$39.00" for one price (or equal prices), "$39.00 – $59.00" for a range, null for none. */
export function formatPriceRange(prices: number[]): string | null {
  const span = priceSpan(prices);
  if (!span) return null;
  return span.min === span.max ? formatCents(span.min) : `${formatCents(span.min)} – ${formatCents(span.max)}`;
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

/** The prices of a backend price span ({min, max}, null when none), for priceLabel. */
export const spanPrices = (min: number | null, max: number | null): number[] => [min, max].filter((c) => c !== null);
