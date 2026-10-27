import { clerkMiddleware } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { clerkEnabled } from './lib/clerk';
import { type HostDecision, routeHost } from './lib/host-routing';
import { routing } from './i18n/routing';

// Next 16 renamed middleware.ts to proxy.ts. Order: Clerk → host routing → next-intl.
// Every check here is UX only; the backend authorises every request from the DB role.
const intl = createMiddleware(routing);
const hosts = { adminHost: process.env.ADMIN_HOST ?? 'admin.localhost:3800', locales: routing.locales };

interface Session {
  userId: string | null;
  role?: 'merchant' | 'admin';
}

function respond(req: NextRequest, decision: HostDecision, session: Session | null) {
  if (decision.kind === 'notFound') return new NextResponse(null, { status: 404 });
  if (decision.kind === 'pass') return NextResponse.next();
  if (decision.guard && !session?.userId) {
    return NextResponse.redirect(new URL(`/${decision.locale ?? routing.defaultLocale}/login`, req.url));
  }
  if (decision.guard === 'admin' && session?.role !== 'admin') return new NextResponse(null, { status: 404 });
  return decision.kind === 'rewrite' ? NextResponse.rewrite(new URL(decision.pathname, req.url)) : intl(req);
}

const decide = (req: NextRequest) => routeHost(req.headers.get('host'), req.nextUrl.pathname, hosts);

const withClerk = clerkMiddleware(async (auth, req) => {
  const decision = decide(req);
  const guarded = decision.kind === 'intl' || decision.kind === 'rewrite' ? decision.guard : null;
  const session = guarded ? await auth() : null;
  return respond(req, decision, session && { userId: session.userId, role: session.sessionClaims?.metadata?.role });
});

// Without Clerk keys nobody can sign in: guarded pages send the visitor to the login page,
// which explains that sign-in is not configured.
const withoutClerk = (req: NextRequest) => respond(req, decide(req), null);

export default clerkEnabled ? withClerk : withoutClerk;

export const config = {
  // Skip Next internals and files with an extension; /api is matched so Clerk can read the session.
  matcher: ['/((?!_next|_vercel|.*\\..*).*)'],
};
