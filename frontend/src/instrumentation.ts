import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from '@/lib/sentry-scrub';

// Server-side error reporting (DESIGN §13); off without NEXT_PUBLIC_SENTRY_DSN.
export async function register() {
  Sentry.init(sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN, process.env.NEXT_PUBLIC_APP_ENV));
}

export const onRequestError = Sentry.captureRequestError;
