// What never leaves the process in logs or error reports (DESIGN §10): the session cookie, bearer tokens, the order
// token (reads and cancels an order) and the idempotency key (a replay answers with the order's link), and the order
// access token in a URL's query.
export const SECRET_HEADERS = ['cookie', 'authorization', 'x-order-token', 'idempotency-key'];
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
