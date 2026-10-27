import type { components } from './schema';
import { api } from './client';

export type PublicListing = components['schemas']['PublicListingDto'];
export type ParticipantPage = components['schemas']['ParticipantPageDto'];

// Public reads: no cookies (buyers are guests and the page never loads Clerk). Works on server and client.
export async function fetchPublicListing(shortCode: string, revalidate?: number): Promise<PublicListing | null> {
  const { data } = await api.GET('/api/v1/public/listings/{shortCode}', {
    params: { path: { shortCode } },
    ...(revalidate === undefined ? { cache: 'no-store' } : { next: { revalidate } }),
  });
  return data ?? null;
}

export async function fetchParticipants(
  shortCode: string,
  cursor?: number,
  revalidate?: number,
): Promise<ParticipantPage | null> {
  const { data } = await api.GET('/api/v1/public/listings/{shortCode}/participants', {
    params: { path: { shortCode }, query: { cursor } },
    ...(revalidate === undefined ? { cache: 'no-store' } : { next: { revalidate } }),
  });
  return data ?? null;
}
