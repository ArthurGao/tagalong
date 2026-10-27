import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import zhCN from '../../../messages/zh-CN.json';
import { ERROR_CODES, errorMessageKey } from './errors';

// The backend catalog mirrors DESIGN §17; the frontend must cover every code in it.
const backendCatalog = readFileSync(
  fileURLToPath(new URL('../../../../backend/src/common/errors/error-codes.ts', import.meta.url)),
  'utf8',
);
const backendCodes = [...backendCatalog.matchAll(/^\s+([A-Z_]+): \d{3},$/gm)].map((m) => m[1]);

describe('error code mapping', () => {
  it('covers exactly the backend catalog', () => {
    expect(backendCodes.length).toBeGreaterThan(20);
    expect([...ERROR_CODES].sort()).toEqual([...backendCodes].sort());
  });

  it('has a message for every code in both locales', () => {
    for (const code of ERROR_CODES) {
      expect(en.errors[code], `en ${code}`).toBeTruthy();
      expect(zhCN.errors[code], `zh-CN ${code}`).toBeTruthy();
    }
  });

  it('maps known codes to their key and anything else to INTERNAL', () => {
    expect(errorMessageKey('SLUG_TAKEN')).toBe('SLUG_TAKEN');
    expect(errorMessageKey('SOMETHING_NEW')).toBe('INTERNAL');
    expect(errorMessageKey(undefined)).toBe('INTERNAL');
  });
});
