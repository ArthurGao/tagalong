import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs';

// What never reaches Sentry from the web app (DESIGN §10): credentials in headers (the Clerk session cookie), the order
// access token in a URL (`?t=`, also in a Referer), request bodies and cookies, and the user. Mirrors the backend's
// redaction (backend/src/common/logging/redact.ts).
const SECRET_HEADERS = ['cookie', 'authorization', 'x-order-token', 'idempotency-key'];
const URL_HEADERS = ['referer', 'referrer'];
const SECRET_QUERY_PARAMS = ['t'];
const REDACTED = '[Redacted]';

/** The URL with the order token's value replaced; relative and absolute URLs alike. */
export function redactUrl(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;
  const hashStart = url.indexOf('#', queryStart);
  const query = url.slice(queryStart + 1, hashStart === -1 ? undefined : hashStart);
  const params = new URLSearchParams(query);
  let changed = false;
  for (const name of SECRET_QUERY_PARAMS) {
    if (params.has(name)) {
      params.set(name, REDACTED);
      changed = true;
    }
  }
  if (!changed) return url;
  return `${url.slice(0, queryStart)}?${params.toString()}${hashStart === -1 ? '' : url.slice(hashStart)}`;
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.url) event.request.url = redactUrl(event.request.url);
    if (typeof event.request.query_string === 'string') event.request.query_string = redactUrl(`?${event.request.query_string}`).slice(1);
    const headers = event.request.headers;
    if (headers) {
      for (const name of Object.keys(headers)) {
        const lower = name.toLowerCase();
        if (SECRET_HEADERS.includes(lower)) headers[name] = REDACTED;
        else if (URL_HEADERS.includes(lower)) headers[name] = redactUrl(headers[name]);
      }
    }
  }
  delete event.user;
  return event;
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  for (const key of ['url', 'from', 'to'] as const) {
    const value = crumb.data?.[key];
    if (typeof value === 'string') crumb.data![key] = redactUrl(value);
  }
  return crumb;
}

/** Shared options: on only with a DSN; no user, cookies, bodies or replay, and no tracing (no sample rate set). */
export function sentryOptions(dsn: string | undefined, environment: string | undefined) {
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: environment ?? 'development',
    dataCollection: { userInfo: false, cookies: false, httpBodies: [], httpHeaders: { deny: SECRET_HEADERS }, urlQueryParams: { deny: SECRET_QUERY_PARAMS } },
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
