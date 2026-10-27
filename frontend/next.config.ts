import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { BACKEND_URL } from './src/lib/backend-url';

const nextConfig: NextConfig = {
  // Same-origin API (DESIGN D6): the browser calls /api/*, Next forwards it to the backend.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${BACKEND_URL}/api/:path*` }];
  },
  // Order pages carry the buyer's access token in ?t=; never send that URL to other sites as a Referer.
  async headers() {
    return [{ source: '/:locale/o/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] }];
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
