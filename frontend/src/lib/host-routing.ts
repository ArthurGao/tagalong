// Host routing (DESIGN §10): one Next.js app serves the main site and the admin host.
// The admin host maps /{locale}/x onto the /{locale}/admin/x route tree; the main host never
// serves /admin. Pure so the whole policy (routing + which guard applies) is unit-tested here;
// proxy.ts only applies the decision.

/** merchant: any signed-in user (pages check the DB role); admin: Clerk role claim must be admin. */
export type Guard = 'merchant' | 'admin' | null;

export type HostDecision =
  | { kind: 'pass' } // API: no locale handling, the backend authorises
  | { kind: 'intl'; locale: string | null; guard: Guard }
  | { kind: 'rewrite'; pathname: string; locale: string; guard: Guard }
  | { kind: 'notFound' };

export interface HostConfig {
  adminHost: string;
  locales: readonly string[];
}

const isUnder = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

function splitLocale(pathname: string, locales: readonly string[]): { locale: string | null; rest: string } {
  const [, first = '', ...more] = pathname.split('/');
  if (locales.includes(first)) return { locale: first, rest: `/${more.join('/')}`.replace(/\/$/, '') || '/' };
  return { locale: null, rest: pathname };
}

export function routeHost(host: string | null, pathname: string, cfg: HostConfig): HostDecision {
  if (isUnder(pathname, '/api')) return { kind: 'pass' };
  const { locale, rest } = splitLocale(pathname, cfg.locales);

  if (host?.toLowerCase() === cfg.adminHost.toLowerCase()) {
    if (!locale) return { kind: 'intl', locale: null, guard: null }; // next-intl redirects to add the locale
    if (isUnder(rest, '/admin')) return { kind: 'notFound' };
    const guard: Guard = isUnder(rest, '/login') ? null : 'admin';
    return { kind: 'rewrite', pathname: `/${locale}/admin${rest === '/' ? '' : rest}`, locale, guard };
  }

  // Every other host (main site, previews) is the main site.
  if (isUnder(rest, '/admin')) return { kind: 'notFound' };
  return { kind: 'intl', locale, guard: isUnder(rest, '/dashboard') ? 'merchant' : null };
}
