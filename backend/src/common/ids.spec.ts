import { SHORT_CODE_ALPHABET, shortCode } from './ids.js';

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
