import { randomBytes, randomInt } from 'node:crypto';

// Lowercase letters and digits without look-alikes (0/o, 1/l/i), so a code read aloud or retyped from a
// screenshot is unambiguous. 31^8 ≈ 8.5e11 codes; the DB unique index catches the rare collision.
export const SHORT_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Public listing code for /l/{shortCode} (DESIGN §5.1). */
export function shortCode(length = 8): string {
  let code = '';
  for (let i = 0; i < length; i++) code += SHORT_CODE_ALPHABET[randomInt(SHORT_CODE_ALPHABET.length)];
  return code;
}

/** Order code shown to buyers and merchants, e.g. "TA-K7M2Q9" (DESIGN §5.1). */
export function publicCode(): string {
  return `TA-${shortCode(6).toUpperCase()}`;
}

/** Secret for the buyer's order link (`?t=`): 32 random bytes, URL-safe. */
export function accessToken(): string {
  return randomBytes(32).toString('base64url');
}
