import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Surfaces never import each other; they share only components/ui and lib (docs/UI-STYLE.md §1).
// import/no-restricted-paths checks the resolved file, so aliases and any relative path are covered.
// Each surface owns a components folder and a route folder under src/app/[locale] (matched by `*`).
const surfaceRoutes = { public: '(public)', merchant: 'dashboard', admin: 'admin' };
const surfaces = Object.keys(surfaceRoutes);
// `allow` lets one surface's files import another's components; only the preview route below uses it.
const isolationRule = (allow = {}) => [
  'error',
  {
    zones: Object.entries(surfaceRoutes).flatMap(([surface, route]) =>
      [`./src/components/${surface}/**`, `./src/app/*/${route}/**`].map((target) => ({
        target,
        from: surfaces
          .filter((other) => other !== surface && !(allow[surface] ?? []).includes(other))
          .map((other) => `./src/components/${other}`),
        message: `The ${surface} surface must not import from another surface's components.`,
      })),
    ),
  },
];
const isolation = { files: ['src/**'], rules: { 'import/no-restricted-paths': isolationRule() } };

// The merchant's preview of a listing is the buyer page itself (DESIGN §11), so that one route renders the public
// surface's components; every other zone still applies. Later blocks replace a rule's options, hence the whole rule.
const previewRoute = {
  files: ['src/app/*/dashboard/**/listings/*/preview/**'],
  rules: { 'import/no-restricted-paths': isolationRule({ merchant: ['public'] }) },
};

const config = [
  { ignores: ['.next/', 'next-env.d.ts', 'src/lib/api/schema.d.ts'] },
  ...nextVitals,
  ...nextTs,
  isolation,
  previewRoute,
];

export default config;
