import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { publicSurface } from './surface-tokens';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const publicBlock = /\[data-surface='public'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
const cssVar = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(publicBlock)?.[1];
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe('publicSurface', () => {
  it.each(Object.entries(publicSurface))('%s matches globals.css', (name, value) => {
    expect(cssVar(kebab(name))).toBe(value);
  });
});
