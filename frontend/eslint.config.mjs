import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Surfaces never import each other; they share only components/ui and lib (docs/UI-STYLE.md §1).
// import/no-restricted-paths checks the resolved file, so aliases and any relative path are covered.
// Each surface owns a components folder and a route folder under src/app/[locale] (matched by `*`).
const surfaceRoutes = { public: '(public)', merchant: 'dashboard', admin: 'admin' };
const surfaces = Object.keys(surfaceRoutes);
const isolation = {
  files: ['src/**'],
  rules: {
    'import/no-restricted-paths': [
      'error',
      {
        zones: Object.entries(surfaceRoutes).flatMap(([surface, route]) =>
          [`./src/components/${surface}/**`, `./src/app/*/${route}/**`].map((target) => ({
            target,
            from: surfaces.filter((other) => other !== surface).map((other) => `./src/components/${other}`),
            message: `The ${surface} surface must not import from another surface's components.`,
          })),
        ),
      },
    ],
  },
};

const config = [
  { ignores: ['.next/', 'next-env.d.ts', 'src/lib/api/schema.d.ts'] },
  ...nextVitals,
  ...nextTs,
  isolation,
];

export default config;
