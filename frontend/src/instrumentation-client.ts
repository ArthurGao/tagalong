import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from '@/lib/sentry-scrub';

// Browser error reporting (DESIGN §13); off without NEXT_PUBLIC_SENTRY_DSN. No session replay: it would record buyer details.
Sentry.init(sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN, process.env.NEXT_PUBLIC_APP_ENV));

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
