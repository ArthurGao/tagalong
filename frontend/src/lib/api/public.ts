import type { components } from './schema';
import { api } from './client';

export type PublicListing = components['schemas']['PublicListingDto'];
export type ParticipantPage = components['schemas']['ParticipantPageDto'];
export type PublicOrder = components['schemas']['PublicOrderDto'];
export type PublicMerchant = components['schemas']['MerchantPageDto'];

/** 404 → null (unknown or hidden); any other failure throws, so SSR shows its error page and polling keeps the last data. */
function okOrNotFound<T>({ data, response }: { data?: T; response: Response }): T | null {
  if (data !== undefined) return data;
  if (response.status === 404) return null;
  throw new Error(`Public API ${response.url} failed with ${response.status}`);
}

/** Cached for `revalidate` seconds (ISR pages), or never (client polling). */
const freshness = (revalidate?: number) => (revalidate === undefined ? { cache: 'no-store' as const } : { next: { revalidate } });

// Public reads: no cookies (buyers are guests and the page never loads Clerk). Works on server and client.
export async function fetchPublicListing(shortCode: string, revalidate?: number): Promise<PublicListing | null> {
  return okOrNotFound(
    await api.GET('/api/v1/public/listings/{shortCode}', {
      params: { path: { shortCode } },
      ...freshness(revalidate),
    }),
  );
}

export async function fetchParticipants(
  shortCode: string,
  cursor?: number,
  revalidate?: number,
): Promise<ParticipantPage | null> {
  return okOrNotFound(
    await api.GET('/api/v1/public/listings/{shortCode}/participants', {
      params: { path: { shortCode }, query: { cursor } },
      ...freshness(revalidate),
    }),
  );
}

/** The buyer's own order (token from the order link); null when the code or token is wrong. */
export async function fetchOrder(publicCode: string, token: string): Promise<PublicOrder | null> {
  return okOrNotFound(
    await api.GET('/api/v1/public/orders/{publicCode}', {
      // A header, not the query string: proxies and request logs never see the token.
      params: { path: { publicCode }, header: { 'X-Order-Token': token } },
      cache: 'no-store',
    }),
  );
}

/** A merchant's public page; null for an unknown slug. */
export async function fetchPublicMerchant(slug: string, revalidate: number): Promise<PublicMerchant | null> {
  return okOrNotFound(await api.GET('/api/v1/public/merchants/{slug}', { params: { path: { slug } }, next: { revalidate } }));
}

/** The order's .ics (event and lesson orders), with the token in the header like every order read. */
export async function fetchOrderCalendar(publicCode: string, token: string): Promise<string | null> {
  return okOrNotFound(
    await api.GET('/api/v1/public/orders/{publicCode}/calendar.ics', {
      params: { path: { publicCode }, header: { 'X-Order-Token': token } },
      parseAs: 'text',
      cache: 'no-store',
    }),
  );
}
