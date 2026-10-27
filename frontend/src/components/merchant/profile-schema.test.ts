import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GST, PHONE, SLUG, profileSchema } from './profile-schema';

const schema = profileSchema((key) => key);
const valid = {
  slug: 'xiaolin-farm',
  displayName: '小林的果园',
  contactEmail: 'hello@xiaolin.test',
  contactPhone: '+64 21 123 4567',
  gstNumber: '',
  description: '',
};
const firstError = (patch: Partial<typeof valid>) => schema.safeParse({ ...valid, ...patch }).error?.issues[0]?.message;

describe('profileSchema (mirrors backend CreateMerchantDto)', () => {
  it('accepts a complete profile with optional fields left empty', () => {
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, gstNumber: '123-456-789' }).success).toBe(true);
  });

  it.each(['ab', 'Xiaolin', '-xiaolin', 'xiaolin-', 'xiao lin', 'a'.repeat(31)])('rejects slug %j', (slug) => {
    expect(firstError({ slug })).toBe('slug');
  });

  it('rejects a blank shop name, bad email, bad phone and bad GST number', () => {
    expect(firstError({ displayName: '   ' })).toBe('required');
    expect(firstError({ contactEmail: 'nope' })).toBe('email');
    expect(firstError({ contactPhone: 'call me' })).toBe('phone');
    expect(firstError({ gstNumber: '12-34' })).toBe('gst');
  });
});

describe('parity with the backend DTO', () => {
  const dto = readFileSync(
    fileURLToPath(new URL('../../../../backend/src/modules/merchants/merchant.dto.ts', import.meta.url)),
    'utf8',
  );
  const backendPattern = (name: string) => dto.match(new RegExp(`^const ${name} = (/.+/);$`, 'm'))?.[1];

  it.each([
    ['SLUG', SLUG],
    ['GST', GST],
    ['PHONE', PHONE],
  ])('%s matches the backend pattern exactly', (name, pattern) => {
    expect(backendPattern(name)).toBe(String(pattern));
  });
});
