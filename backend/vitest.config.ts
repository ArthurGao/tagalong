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
          env: {
            APP_URL: 'http://localhost:3800',
            DATABASE_URL: 'postgresql://tagalong:tagalong@localhost:5442/tagalong',
          },
        },
      },
    ],
  },
});
