import { describe, expect, it } from 'vitest';
import { edgeHeaders } from './edge-forward';

describe('edgeHeaders (the buyer IP passed to the API)', () => {
  it('passes the client IP Vercel determined, with the secret', () => {
    const h = edgeHeaders(new Headers({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '203.0.113.7', cookie: 'a=b' }), 'edge-secret');
    expect([h.get('x-tagalong-edge'), h.get('x-tagalong-client-ip'), h.get('cookie')]).toEqual(['edge-secret', '203.0.113.7', 'a=b']);
    expect(edgeHeaders(new Headers({ 'x-forwarded-for': '203.0.113.8, 10.0.0.1' }), 'edge-secret').get('x-tagalong-client-ip')).toBe('203.0.113.8');
  });

  it('never forwards what the browser sent as ours, and adds nothing without a secret', () => {
    const forged = new Headers({ 'x-tagalong-edge': 'guess', 'x-tagalong-client-ip': '1.2.3.4', 'x-real-ip': '203.0.113.7' });
    const withoutSecret = edgeHeaders(forged, undefined);
    expect([withoutSecret.get('x-tagalong-edge'), withoutSecret.get('x-tagalong-client-ip')]).toEqual([null, null]);
    expect(edgeHeaders(forged, 'edge-secret').get('x-tagalong-client-ip')).toBe('203.0.113.7');
  });
});
