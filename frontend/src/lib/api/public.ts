import type { components } from './schema';
import { api } from './client';

export type PublicListing = components['schemas']['PublicListingDto'];
export type ParticipantPage = components['schemas']['ParticipantPageDto'];

/** 404 → null (unknown or hidden); any other failure throws, so SSR shows its error page and polling keeps the last data. */
function okOrNotFound<T>({ data, response }: { data?: T; response: Response }): T | null {
  if (data !== undefined) return data;
  if (response.status === 404) return null;
  throw new Error(`Public API ${response.url} failed with ${response.status}`);
}

// Public reads: no cookies (buyers are guests and the page never loads Clerk). Works on server and client.
export async function fetchPublicListing(shortCode: string, revalidate?: number): Promise<PublicListing | null> {
  return okOrNotFound(
    await api.GET('/api/v1/public/listings/{shortCode}', {
      params: { path: { shortCode } },
      ...(revalidate === undefined ? { cache: 'no-store' } : { next: { revalidate } }),
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
      ...(revalidate === undefined ? { cache: 'no-store' } : { next: { revalidate } }),
    }),
  );
}
