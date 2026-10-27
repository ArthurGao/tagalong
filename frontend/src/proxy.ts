import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

// Next 16 renamed middleware.ts to proxy.ts. M0: locale routing only; host routing and Clerk arrive in M1.
export default createMiddleware(routing);

export const config = {
  // Skip the API rewrite, Next internals and files with an extension.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
