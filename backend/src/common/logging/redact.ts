// What never leaves the process in logs or error reports (DESIGN §10): the session cookie, bearer tokens, the order
// token (reads and cancels an order) and the idempotency key (a replay answers with the order's link), and the order
// access token in a URL's query.
export const SECRET_HEADERS = ['cookie', 'authorization', 'x-order-token', 'idempotency-key', 'x-tagalong-edge', 'x-tagalong-client-ip'];
export const SECRET_QUERY_PARAMS = ['t'];
export const REDACTED = '[Redacted]';

/** A query string (no "?") with every secret parameter's value replaced; unchanged when there is none. */
export function redactQuery(query: string): string {
  const params = new URLSearchParams(query);
  if (!SECRET_QUERY_PARAMS.some((name) => params.has(name))) return query;
  for (const name of SECRET_QUERY_PARAMS) if (params.has(name)) params.set(name, REDACTED);
  return params.toString();
}

/** The URL with every secret query parameter's value replaced; the rest of the query is kept. */
export function redactUrl(url: string): string {
  const queryStart = url.indexOf('?');
  return queryStart === -1 ? url : `${url.slice(0, queryStart)}?${redactQuery(url.slice(queryStart + 1))}`;
}

const EMAIL = /[^\s@()<>,;:"'=]+@[^\s@()<>,;:"']+\.[^\s@()<>,;:"']+/g;
// Phone numbers as buyers type them: +64 or a trunk 0, then at least 7 more digits (dates and ids do not start so).
const PHONE = /(?:\+\d{1,3}[\s-]?|\b0)\d[\d\s-]{5,}\d/g;
const TOKEN_PARAM = new RegExp(`([?&](?:${SECRET_QUERY_PARAMS.join('|')})=)[^&\\s#]+`, 'g');

/** Free text (an error message, a log breadcrumb) with emails, phone numbers and order tokens taken out. */
export function redactText(text: string): string {
  return text.replace(EMAIL, '[email]').replace(TOKEN_PARAM, '$1%5BRedacted%5D').replace(PHONE, '[number]');
}
