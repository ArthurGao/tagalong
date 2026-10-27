import type { Request } from 'express';

// Same-origin web requests carry Clerk's __session cookie; Bearer is kept for a future native app.
export function extractSessionToken(req: Pick<Request, 'cookies' | 'headers'>): string | null {
  const cookie = (req.cookies as Record<string, string | undefined> | undefined)?.__session;
  if (cookie) return cookie;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim() || null;
  return null;
}
