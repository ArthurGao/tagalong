import * as Sentry from '@sentry/nestjs';
import type { Env } from '../../config/env.js';
import { REDACTED, redactQuery, redactUrl, SECRET_HEADERS, SECRET_QUERY_PARAMS } from '../logging/redact.js';

type ErrorEvent = Sentry.ErrorEvent;
type Breadcrumb = Sentry.Breadcrumb;

/**
 * Sentry for the API (DESIGN §13), on only with a DSN. Collects no user, cookies or bodies; no tracing (no sample rate
 * set, so no tracing integrations load). Every
 * event also goes through `scrubEvent`, so the credentials the logger redacts never reach Sentry even if a default
 * changes, nor request bodies (buyer details).
 */
export function sentryOptions(env: Pick<Env, 'SENTRY_DSN' | 'APP_ENV' | 'RENDER_GIT_COMMIT'>): Sentry.NodeOptions {
  return {
    dsn: env.SENTRY_DSN,
    environment: env.APP_ENV,
    release: env.RENDER_GIT_COMMIT || undefined,
    // Nothing about the person by default: no user, cookies or bodies; headers and query only minus the secrets.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      httpHeaders: { deny: SECRET_HEADERS },
      urlQueryParams: { deny: SECRET_QUERY_PARAMS },
    },
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}

/** The event without secrets or buyer data: secret headers redacted, cookies, body and user dropped, URLs redacted. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const request = event.request;
  if (request) {
    delete request.data;
    delete request.cookies;
    if (request.url) request.url = redactUrl(request.url);
    const query = request.query_string;
    if (query) request.query_string = redactQuery(typeof query === 'string' ? query : new URLSearchParams(query as Record<string, string>).toString());
    if (request.headers) {
      for (const name of Object.keys(request.headers)) {
        const lower = name.toLowerCase();
        if (SECRET_HEADERS.includes(lower)) request.headers[name] = REDACTED;
        else if (lower === 'referer' || lower === 'referrer') request.headers[name] = redactUrl(request.headers[name]); // an order page's ?t=
      }
    }
  }
  delete event.user;
  return event;
}

function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  if (typeof crumb.data?.url === 'string') crumb.data.url = redactUrl(crumb.data.url);
  return crumb;
}

/** An error nobody answered for (an unexpected 500, a job giving up): to Sentry when it is on, a no-op otherwise. */
export function reportError(error: unknown, context?: Record<string, string | number>): void {
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
