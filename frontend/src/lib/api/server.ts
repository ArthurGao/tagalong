import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { api } from './client';

// Server components call the backend directly and forward the browser's cookies (Clerk __session).
// cache(): layouts and pages of one render share a single /me call.
export const getMe = cache(async () => {
  const { data } = await api.GET('/api/v1/me', {
    headers: { cookie: (await cookies()).toString() },
    cache: 'no-store',
  });
  return data ?? null;
});

// Page-level gates on the DB role (the proxy only checks for a session / the Clerk role claim).
export async function requireMerchant(locale: string) {
  const me = await getMe();
  if (!me) redirect(`/${locale}/login`);
  if (me.role !== 'MERCHANT') notFound();
  return me;
}

export async function requireAdmin(locale: string) {
  const me = await getMe();
  if (!me) redirect(`/${locale}/login`);
  if (me.role !== 'ADMIN') notFound();
  return me;
}
