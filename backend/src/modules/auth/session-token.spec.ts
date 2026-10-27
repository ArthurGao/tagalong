import { extractSessionToken } from './session-token.js';

const req = (cookies: Record<string, string> | undefined, authorization?: string) =>
  ({ cookies, headers: { authorization } }) as Parameters<typeof extractSessionToken>[0];

describe('extractSessionToken', () => {
  it('prefers the __session cookie', () => {
    expect(extractSessionToken(req({ __session: 'from-cookie' }, 'Bearer from-header'))).toBe('from-cookie');
  });

  it('falls back to a Bearer header', () => {
    expect(extractSessionToken(req({}, 'Bearer from-header'))).toBe('from-header');
  });

  it('ignores other schemes and empty bearer values', () => {
    expect(extractSessionToken(req(undefined, 'Basic abc'))).toBeNull();
    expect(extractSessionToken(req(undefined, 'Bearer   '))).toBeNull();
    expect(extractSessionToken(req(undefined))).toBeNull();
  });
});
