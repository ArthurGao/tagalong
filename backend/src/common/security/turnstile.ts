import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';

// Cloudflare's documented test secret: every token passes. Used only outside production when no secret is set.
const TEST_SECRET = '1x0000000000000000000000000000000AA';

// DESIGN §10: every public order is human-verified. Tests swap this token for a fake; they never call Cloudflare.
export abstract class TurnstileVerifier {
  /** True when Cloudflare accepts the token. Tokens are single-use, so verify once per new order. */
  abstract verify(token: string, remoteIp: string | undefined): Promise<boolean>;
}

@Injectable()
export class CloudflareTurnstileVerifier extends TurnstileVerifier {
  constructor(@Inject(ENV) private readonly env: Env) {
    super();
  }

  async verify(token: string, remoteIp: string | undefined): Promise<boolean> {
    const body = new URLSearchParams({ secret: this.env.TURNSTILE_SECRET_KEY || TEST_SECRET, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok && ((await res.json()) as { success?: boolean }).success === true;
    } catch {
      return false; // fail closed: an unverifiable request is treated as unverified
    }
  }
}
