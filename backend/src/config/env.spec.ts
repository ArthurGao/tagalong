import { parseEnv } from './env.js';

const valid = {
  APP_URL: 'http://localhost:3800',
  DATABASE_URL: 'postgresql://tagalong:tagalong@localhost:5442/tagalong',
};

const clerk = {
  CLERK_SECRET_KEY: 'sk_test_x',
  CLERK_JWT_KEY: '-----BEGIN PUBLIC KEY-----x',
  CLERK_AUTHORIZED_PARTIES: 'http://localhost:3800, http://admin.localhost:3800',
  CLERK_WEBHOOK_SIGNING_SECRET: 'whsec_x',
  ADMIN_EMAIL_ALLOWLIST: 'Ops@TagAlong.nz, admin2@tagalong.nz',
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET_CONNECT: 'whsec_c',
  STRIPE_WEBHOOK_SECRET_PLATFORM: 'whsec_p',
  S3_BUCKET: 'b',
  S3_ACCESS_KEY_ID: 'k',
  S3_SECRET_ACCESS_KEY: 's',
  S3_PUBLIC_BASE_URL: 'https://img.example',
};

describe('parseEnv', () => {
  it('applies defaults for PORT and NODE_ENV', () => {
    expect(parseEnv(valid)).toMatchObject({ ...valid, PORT: 3810, NODE_ENV: 'development' });
  });

  it('coerces PORT from a string', () => {
    expect(parseEnv({ ...valid, PORT: '4321' }).PORT).toBe(4321);
  });

  it('fails fast and names every missing variable', () => {
    expect(() => parseEnv({})).toThrow('Invalid environment configuration: APP_URL, DATABASE_URL');
  });

  it('splits list variables and lower-cases the admin allowlist', () => {
    const env = parseEnv({ ...valid, ...clerk });
    expect(env.CLERK_AUTHORIZED_PARTIES).toEqual(['http://localhost:3800', 'http://admin.localhost:3800']);
    expect(env.ADMIN_EMAIL_ALLOWLIST).toEqual(['ops@tagalong.nz', 'admin2@tagalong.nz']);
  });

  it('lets development run without Clerk keys', () => {
    expect(parseEnv(valid)).toMatchObject({ CLERK_JWT_KEY: '', CLERK_AUTHORIZED_PARTIES: [], ADMIN_EMAIL_ALLOWLIST: [] });
  });

  it('requires every Clerk, Stripe and storage variable in production', () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: 'production' })).toThrow(
      'Invalid environment configuration: CLERK_SECRET_KEY, CLERK_JWT_KEY, CLERK_AUTHORIZED_PARTIES, CLERK_WEBHOOK_SIGNING_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET_CONNECT, STRIPE_WEBHOOK_SECRET_PLATFORM, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_BASE_URL',
    );
    expect(() => parseEnv({ ...valid, ...clerk, NODE_ENV: 'production' })).not.toThrow();
  });
});
