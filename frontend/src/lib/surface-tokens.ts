// The public surface's colours for places CSS variables can't reach (Satori OG images).
// Must equal [data-surface='public'] in app/globals.css; surface-tokens.test.ts checks that.
export const publicSurface = {
  background: '#f2f5ef',
  foreground: '#1a2b22',
  primary: '#c92a39',
  mutedForeground: '#4a5a50',
} as const;
