import { parseEnv } from './env.js';

const valid = {
  APP_URL: 'http://localhost:3800',
  DATABASE_URL: 'postgresql://tagalong:tagalong@localhost:5442/tagalong',
};

describe('parseEnv', () => {
  it('applies defaults for PORT and NODE_ENV', () => {
    expect(parseEnv(valid)).toEqual({ ...valid, PORT: 3810, NODE_ENV: 'development' });
  });

  it('coerces PORT from a string', () => {
    expect(parseEnv({ ...valid, PORT: '4321' }).PORT).toBe(4321);
  });

  it('fails fast and names every missing variable', () => {
    expect(() => parseEnv({})).toThrow('Invalid environment configuration: APP_URL, DATABASE_URL');
  });
});
