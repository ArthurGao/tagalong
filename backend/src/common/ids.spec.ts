import { accessToken, publicCode, SHORT_CODE_ALPHABET, shortCode } from './ids.js';

describe('shortCode', () => {
  it('is 8 characters from an alphabet without look-alikes (0/o, 1/l/i)', () => {
    for (let i = 0; i < 500; i++) {
      const code = shortCode();
      expect(code).toMatch(/^[a-z2-9]{8}$/);
      expect(code).not.toMatch(/[01oli]/);
    }
    expect(SHORT_CODE_ALPHABET).toHaveLength(31);
  });

  it('is random (no repeats in a sample)', () => {
    const codes = new Set(Array.from({ length: 2000 }, () => shortCode()));
    expect(codes.size).toBe(2000);
  });
});

describe('publicCode / accessToken', () => {
  it('order codes read as TA- plus 6 unambiguous upper-case characters', () => {
    for (let i = 0; i < 200; i++) expect(publicCode()).toMatch(/^TA-[A-HJKMNP-Z2-9]{6}$/);
  });

  it('access tokens carry 256 bits, URL-safe, and never repeat', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => accessToken()));
    expect(tokens.size).toBe(500);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
