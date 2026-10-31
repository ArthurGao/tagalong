// The buyer's IP for the API's rate limits and audit (backend common/security/edge-client-ip.ts). The API is also
// reachable directly, so it trusts a client IP only alongside this shared secret. Vercel sets x-real-ip and
// x-forwarded-for itself (a client cannot spoof them through Vercel), so they name the real client here.
export const EDGE_SECRET_HEADER = 'x-tagalong-edge';
export const EDGE_CLIENT_IP_HEADER = 'x-tagalong-client-ip';

/** The /api request's headers with ours replaced: never what the browser sent, and the client IP only with a secret. */
export function edgeHeaders(incoming: Headers, secret: string | undefined): Headers {
  const headers = new Headers(incoming);
  headers.delete(EDGE_SECRET_HEADER);
  headers.delete(EDGE_CLIENT_IP_HEADER);
  const ip = incoming.get('x-real-ip') ?? incoming.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (secret && ip) {
    headers.set(EDGE_SECRET_HEADER, secret);
    headers.set(EDGE_CLIENT_IP_HEADER, ip);
  }
  return headers;
}
