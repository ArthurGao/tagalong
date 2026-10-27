import type { Env } from '../../config/env.js';
import { CloudflareTurnstileVerifier } from './turnstile.js';

// The network boundary (Cloudflare siteverify) is mocked; the test never leaves the process.
describe('CloudflareTurnstileVerifier', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  afterEach(() => fetchSpy.mockReset());
  const verifier = (secret = '') => new CloudflareTurnstileVerifier({ TURNSTILE_SECRET_KEY: secret } as Env);
  const sent = () => new URLSearchParams(fetchSpy.mock.calls[0][1]!.body as URLSearchParams);

  it('passes only when Cloudflare says success, sending the secret, token and client IP', async () => {
    fetchSpy.mockResolvedValueOnce(Response.json({ success: true }));
    expect(await verifier('0x4AAA').verify('tok', '203.0.113.9')).toBe(true);
    expect(Object.fromEntries(sent())).toEqual({ secret: '0x4AAA', response: 'tok', remoteip: '203.0.113.9' });
    fetchSpy.mockResolvedValueOnce(Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] }));
    expect(await verifier('0x4AAA').verify('tok', undefined)).toBe(false);
  });

  it('fails closed when Cloudflare cannot be reached, and uses the test secret when none is set', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('network down'));
    expect(await verifier().verify('tok', undefined)).toBe(false);
    expect(sent().get('secret')).toBe('1x0000000000000000000000000000000AA');
  });
});
