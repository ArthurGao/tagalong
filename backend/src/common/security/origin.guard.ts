import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { API_PREFIX } from '../api-prefix.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { AppError } from '../errors/app-error.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const PUBLIC_PREFIX = `/${API_PREFIX}/public/`;

// CSRF defence in depth (DESIGN §9). Clerk's __session cookie is SameSite=Lax, but the admin host is
// same-site with the main site, so every unsafe request that carries cookies, and every public write,
// must come from one of our own origins. Cookie-less callers (webhooks, Bearer clients) are unaffected.
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: ReadonlySet<string>;

  constructor(@Inject(ENV) env: Env) {
    this.allowed = new Set([new URL(env.APP_URL).origin, ...env.CLERK_AUTHORIZED_PARTIES.map((o) => new URL(o).origin)]);
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    const needsOrigin = Boolean(req.headers.cookie) || req.path.startsWith(PUBLIC_PREFIX);
    if (!needsOrigin) return true;
    const origin = req.headers.origin;
    if (origin && this.allowed.has(origin)) return true;
    throw new AppError('FORBIDDEN', 'Cross-origin request rejected');
  }
}
