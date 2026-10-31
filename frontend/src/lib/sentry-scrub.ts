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

const EMAIL = /[^\s@()<>,;:"'=]+@[^\s@()<>,;:"']+\.[^\s@()<>,;:"']+/g;
// Phone numbers as buyers type them: +64 or a trunk 0, then at least 7 more digits (dates and ids do not start so).
const PHONE = /(?:\+\d{1,3}[\s-]?|\b0)\d[\d\s-]{5,}\d/g;
const TOKEN_PARAM = new RegExp(`([?&](?:${SECRET_QUERY_PARAMS.join('|')})=)[^&\\s#]+`, 'g');

/** Free text (an error message, a console breadcrumb) with emails, phone numbers and order tokens taken out. */
export function redactText(text: string): string {
  return text.replace(EMAIL, '[email]').replace(TOKEN_PARAM, '$1%5BRedacted%5D').replace(PHONE, '[number]');
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
  if (event.message) event.message = redactText(event.message);
  for (const value of event.exception?.values ?? []) if (value.value) value.value = redactText(value.value);
  if (event.extra) event.extra = redactValues(event.extra);
  return event;
}

/** String values of a context object text-redacted; others kept. */
const redactValues = (data: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? redactText(v) : v]));


export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  if (crumb.data) {
    // A console breadcrumb's raw arguments repeat its message, which is redacted below.
    const data = { ...crumb.data };
    delete data.arguments;
    crumb.data = redactValues(data);
  }
  for (const key of ['url', 'from', 'to'] as const) {
    const value = crumb.data?.[key];
    if (typeof value === 'string') crumb.data![key] = redactUrl(value);
  }
  if (crumb.message) crumb.message = redactText(crumb.message);
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
