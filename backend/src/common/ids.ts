import { randomInt } from 'node:crypto';

// Lowercase letters and digits without look-alikes (0/o, 1/l/i), so a code read aloud or retyped from a
// screenshot is unambiguous. 31^8 ≈ 8.5e11 codes; the DB unique index catches the rare collision.
export const SHORT_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Public listing code for /l/{shortCode} (DESIGN §5.1). */
export function shortCode(length = 8): string {
  let code = '';
  for (let i = 0; i < length; i++) code += SHORT_CODE_ALPHABET[randomInt(SHORT_CODE_ALPHABET.length)];
  return code;
}
