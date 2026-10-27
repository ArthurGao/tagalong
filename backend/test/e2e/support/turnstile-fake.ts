import type { TurnstileVerifier } from '../../../src/common/security/turnstile.js';

export const TURNSTILE_PASS = 'turnstile-ok';

/** Accepts the test token only, and records what it was asked. */
export class FakeTurnstileVerifier implements TurnstileVerifier {
  readonly calls: { token: string; remoteIp: string | undefined }[] = [];

  reset(): void {
    this.calls.length = 0;
  }

  async verify(token: string, remoteIp: string | undefined): Promise<boolean> {
    this.calls.push({ token, remoteIp });
    return token === TURNSTILE_PASS;
  }
}
