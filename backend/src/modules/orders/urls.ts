import type { Env } from '../../config/env.js';

// Buyer-facing links; the frontend routes are /{locale}/… (next-intl, every locale prefixed).
export function orderUrl(env: Env, locale: string, publicCode: string, token: string, paid = false): string {
  const url = new URL(`/${locale}/o/${encodeURIComponent(publicCode)}`, env.APP_URL);
  url.searchParams.set('t', token);
  if (paid) url.searchParams.set('paid', '1');
  return url.toString();
}

export function listingUrl(env: Env, locale: string, shortCode: string): string {
  return new URL(`/${locale}/l/${encodeURIComponent(shortCode)}`, env.APP_URL).toString();
}
