import type { NextFunction, Request, Response } from 'express';
import { edgeClientIp } from './edge-client-ip.js';

function call(secret: string, headers: Record<string, string>) {
  const req = { headers: { ...headers }, ip: '10.0.0.9' } as unknown as Request; // what trust proxy gave: the load balancer's view
  const next = vi.fn() as NextFunction;
  edgeClientIp(secret)(req, {} as Response, next);
  expect(next).toHaveBeenCalledOnce();
  return req;
}

describe('edgeClientIp (the buyer IP behind our own web app only)', () => {
  it('takes the client IP the web app passed with the right secret', () => {
    const req = call('s3cret-edge', { 'x-tagalong-edge': 's3cret-edge', 'x-tagalong-client-ip': '203.0.113.7' });
    expect(req.ip).toBe('203.0.113.7');
  });

  it.each([
    ['a wrong secret', 's3cret-edge', { 'x-tagalong-edge': 'guess', 'x-tagalong-client-ip': '203.0.113.7' }],
    ['no secret', 's3cret-edge', { 'x-tagalong-client-ip': '203.0.113.7' }],
    ['not an IP', 's3cret-edge', { 'x-tagalong-edge': 's3cret-edge', 'x-tagalong-client-ip': 'evil, 1.2.3.4' }],
    ['no secret configured', '', { 'x-tagalong-edge': '', 'x-tagalong-client-ip': '203.0.113.7' }],
  ])('keeps the proxy-derived IP with %s, and drops the headers', (_case, secret, headers) => {
    const req = call(secret, headers);
    expect(req.ip).toBe('10.0.0.9');
    expect(req.headers).toEqual({});
  });
});
