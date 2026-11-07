import { describe, expect, it } from 'vitest';
import { surfaceAppearance } from './clerk';

// Clerk deprecated colorText / colorTextSecondary / colorInputBackground / colorInputText (2025-07-15) and ignores them now:
// the sign-in card then kept Clerk's default dark text on the merchant surface's dark-mode card.
describe('surfaceAppearance (Clerk follows the surface tokens)', () => {
  it('sets text, muted text and input colours with the current variable names', () => {
    expect(surfaceAppearance.variables).toMatchObject({
      colorForeground: 'var(--foreground)',
      colorMutedForeground: 'var(--muted-foreground)',
      colorInput: 'var(--card)',
      colorInputForeground: 'var(--foreground)',
      colorPrimaryForeground: 'var(--primary-foreground)',
      colorBackground: 'var(--card)',
      // Secondary buttons (Google), borders and dividers derive from the neutral colour: black by default.
      colorNeutral: 'var(--foreground)',
    });
  });

  it('uses none of the deprecated names', () => {
    const deprecated = ['colorText', 'colorTextSecondary', 'colorTextOnPrimaryBackground', 'colorInputBackground', 'colorInputText', 'spacingUnit'];
    expect(Object.keys(surfaceAppearance.variables).filter((k) => deprecated.includes(k))).toEqual([]);
  });
});
