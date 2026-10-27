import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC (not esbuild) so Nest decorators get their emitted metadata.
const shared = { plugins: [swc.vite({ module: { type: 'es6' } })], test: { globals: true } } as const;

export default defineConfig({
  test: {
    projects: [
      { ...shared, test: { ...shared.test, name: 'unit', include: ['src/**/*.spec.ts'] } },
      {
        ...shared,
        test: {
          ...shared.test,
          name: 'e2e',
          include: ['test/**/*.e2e-spec.ts'],
          // A Testcontainers Postgres per run; DATABASE_URL comes from globalSetup via inject().
          globalSetup: ['test/e2e/support/global-setup.ts'],
          setupFiles: ['test/e2e/support/setup-env.ts'],
          hookTimeout: 120_000,
          // Files share one database and truncate it between tests, so they must not overlap.
          fileParallelism: false,
          env: {
            APP_URL: 'http://localhost:3800',
            // High enough for the concurrency tests; rate-limit.e2e-spec.ts lowers it for its own app.
            ORDER_RATE_LIMIT_PER_MINUTE: '100000',
            // Test-only secret: base64 of "tagalong-e2e-webhook-secret".
            CLERK_WEBHOOK_SIGNING_SECRET: 'whsec_dGFnYWxvbmctZTJlLXdlYmhvb2stc2VjcmV0',
            ADMIN_EMAIL_ALLOWLIST: 'ops@tagalong.test',
            STRIPE_WEBHOOK_SECRET_CONNECT: 'whsec_test_connect',
            STRIPE_WEBHOOK_SECRET_PLATFORM: 'whsec_test_platform',
          },
        },
      },
    ],
  },
});
