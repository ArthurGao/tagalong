import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import proxy from './proxy';

// Boundaries the rewrite does not reach: next-intl's own middleware and Clerk (no keys in tests).
vi.mock('next-intl/middleware', () => ({ default: () => () => new Response(null) }));
vi.mock('@clerk/nextjs/server', () => ({ clerkMiddleware: () => () => new Response(null) }));

// Without Clerk keys (as in tests) guarded pages redirect to login, so the unguarded login page shows the rewrite; every
// admin page (?id=, filters, cursor) is rewritten the same way.
describe('proxy (admin host rewrite)', () => {
  it('keeps the query string when rewriting into the admin tree', async () => {
    const req = new NextRequest('http://admin.localhost:3800/en/login?redirect_url=%2Fen%2Fmerchants&x=1');
    req.headers.set('host', 'admin.localhost:3800'); // a forbidden header in Request init, as a browser sends it
    const res = await proxy(req, {} as never);
    const rewrite = res!.headers.get('x-middleware-rewrite');
    expect(rewrite).not.toBeNull();
    const target = new URL(rewrite!, 'http://admin.localhost:3800');
    expect(target.pathname).toBe('/en/admin/login');
    expect(target.search).toBe('?redirect_url=%2Fen%2Fmerchants&x=1');
  });
});
