import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { api } from './client';
import type { paths } from './schema';

// Server components call the backend directly and forward the browser's cookies (Clerk __session).
// cache(): layouts and pages of one render share a single /me call.
// Reads only: the backend's OriginGuard rejects cookie-carrying writes without a browser Origin,
// so mutations go through client components.
// Every read is per-user, so never cached across requests.
const authed = async () => ({ headers: { cookie: (await cookies()).toString() }, cache: 'no-store' as const });

export const getMe = cache(async () => {
  const { data } = await api.GET('/api/v1/me', await authed());
  return data ?? null;
});

// The merchant profile as stored (Stripe flags from the last sync; no call to Stripe).
export const getMyMerchant = cache(async () => {
  const { data } = await api.GET('/api/v1/merchants/me', await authed());
  return data ?? null;
});

// The merchant profile after the backend re-reads the live Stripe account; only for the return page.
export const getMerchantWithLiveStripe = cache(async () => {
  const { data } = await api.GET('/api/v1/merchants/me/stripe/status', await authed());
  return data ?? null;
});

export const getMyListings = cache(async () => {
  const { data } = await api.GET('/api/v1/merchants/me/listings', await authed());
  return data ?? [];
});

export const getListing = cache(async (id: string) => {
  const { data } = await api.GET('/api/v1/merchants/me/listings/{id}', {
    params: { path: { id } },
    ...(await authed()),
  });
  return data ?? null;
});

// Page-level gates on the DB role (the proxy only checks for a session / the Clerk role claim).
async function requireRole(locale: string, role: 'MERCHANT' | 'ADMIN') {
  const me = await getMe();
  if (!me) redirect(`/${locale}/login`);
  if (me.role !== role) notFound();
  return me;
}

export const requireMerchant = (locale: string) => requireRole(locale, 'MERCHANT');
export const requireAdmin = (locale: string) => requireRole(locale, 'ADMIN');

export const getListingOrders = cache(async (id: string) => {
  const { data } = await api.GET('/api/v1/merchants/me/listings/{id}/orders', {
    params: { path: { id }, query: {} },
    ...(await authed()),
  });
  return data ?? null;
});

// Admin console reads (DESIGN §9 Admin). The backend checks the DB role on every one.
type Query<P extends keyof paths> = paths[P]['get'] extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never;

export const getAdminStats = cache(async () => {
  const { data } = await api.GET('/api/v1/admin/stats', await authed());
  return data ?? null;
});

export async function getAdminMerchants(query: Query<'/api/v1/admin/merchants'>) {
  const { data } = await api.GET('/api/v1/admin/merchants', { params: { query }, ...(await authed()) });
  return data ?? null;
}

export async function getAdminMerchant(id: string) {
  const { data } = await api.GET('/api/v1/admin/merchants/{id}', { params: { path: { id } }, ...(await authed()) });
  return data ?? null;
}

export async function getAdminListings(query: Query<'/api/v1/admin/listings'>) {
  const { data } = await api.GET('/api/v1/admin/listings', { params: { query }, ...(await authed()) });
  return data ?? null;
}

export async function getAdminListing(id: string) {
  const { data } = await api.GET('/api/v1/admin/listings/{id}', { params: { path: { id } }, ...(await authed()) });
  return data ?? null;
}

export async function getAdminDisputes(query: Query<'/api/v1/admin/disputes'>) {
  const { data } = await api.GET('/api/v1/admin/disputes', { params: { query }, ...(await authed()) });
  return data ?? null;
}
