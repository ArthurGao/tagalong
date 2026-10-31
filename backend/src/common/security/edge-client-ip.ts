import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { NextFunction, Request, Response } from 'express';

export const EDGE_SECRET_HEADER = 'x-tagalong-edge';
export const EDGE_CLIENT_IP_HEADER = 'x-tagalong-client-ip';

const sameSecret = (given: string, secret: string) =>
  given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));

/**
 * The buyer's IP when the request came through our own web app (DESIGN §10 rate limits, admin audit). The API is
 * reached both through Vercel's rewrite and directly (webhooks, anyone), so no proxy hop count is right for both: a
 * direct caller could forge X-Forwarded-For. Instead the web app's proxy passes the client IP Vercel determined with a
 * shared secret; only with that secret does it become `req.ip`. Otherwise `req.ip` stays what `trust proxy` gives
 * (Render's load balancer, one hop). The headers are removed either way, so nothing downstream can read a forged one.
 */
export function edgeClientIp(secret: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const given = req.headers[EDGE_SECRET_HEADER];
    const ip = req.headers[EDGE_CLIENT_IP_HEADER];
    delete req.headers[EDGE_SECRET_HEADER];
    delete req.headers[EDGE_CLIENT_IP_HEADER];
    if (secret && typeof given === 'string' && typeof ip === 'string' && isIP(ip) && sameSecret(given, secret)) {
      Object.defineProperty(req, 'ip', { value: ip, configurable: true });
    }
    next();
  };
}
