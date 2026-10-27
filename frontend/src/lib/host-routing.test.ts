import { describe, expect, it } from 'vitest';
import { routeHost } from './host-routing';

const cfg = { adminHost: 'admin.localhost:3800', locales: ['zh-CN', 'en'] as const };
const main = (path: string) => routeHost('localhost:3800', path, cfg);
const admin = (path: string) => routeHost('admin.localhost:3800', path, cfg);

describe('routeHost', () => {
  describe('main host', () => {
    it('passes public pages to next-intl without a guard', () => {
      expect(main('/zh-CN')).toEqual({ kind: 'intl', locale: 'zh-CN', guard: null });
      expect(main('/en/l/abc12345')).toEqual({ kind: 'intl', locale: 'en', guard: null });
      expect(main('/')).toEqual({ kind: 'intl', locale: null, guard: null });
    });

    it('guards the dashboard as a merchant area', () => {
      expect(main('/zh-CN/dashboard')).toEqual({ kind: 'intl', locale: 'zh-CN', guard: 'merchant' });
      expect(main('/en/dashboard/onboarding/profile')).toEqual({ kind: 'intl', locale: 'en', guard: 'merchant' });
      expect(main('/dashboard')).toEqual({ kind: 'intl', locale: null, guard: 'merchant' });
    });

    it('does not treat look-alike paths as the dashboard', () => {
      expect(main('/zh-CN/dashboards')).toEqual({ kind: 'intl', locale: 'zh-CN', guard: null });
    });

    it('returns 404 for every /admin path, with or without a locale', () => {
      for (const path of ['/admin', '/admin/merchants', '/zh-CN/admin', '/en/admin/orders']) {
        expect(main(path)).toEqual({ kind: 'notFound' });
      }
      expect(main('/zh-CN/administrator')).toEqual({ kind: 'intl', locale: 'zh-CN', guard: null });
    });

    it('treats unknown hosts (previews) like the main host', () => {
      expect(routeHost('preview-123.vercel.app', '/zh-CN/admin', cfg)).toEqual({ kind: 'notFound' });
      expect(routeHost(null, '/zh-CN/dashboard', cfg)).toEqual({ kind: 'intl', locale: 'zh-CN', guard: 'merchant' });
    });
  });

  describe('admin host', () => {
    it('rewrites localised paths into the admin route tree behind the admin guard', () => {
      expect(admin('/zh-CN')).toEqual({ kind: 'rewrite', pathname: '/zh-CN/admin', locale: 'zh-CN', guard: 'admin' });
      expect(admin('/en/merchants')).toEqual({
        kind: 'rewrite',
        pathname: '/en/admin/merchants',
        locale: 'en',
        guard: 'admin',
      });
    });

    it('leaves the admin login page public', () => {
      expect(admin('/zh-CN/login')).toEqual({ kind: 'rewrite', pathname: '/zh-CN/admin/login', locale: 'zh-CN', guard: null });
      expect(admin('/en/login/factor-one')).toEqual({
        kind: 'rewrite',
        pathname: '/en/admin/login/factor-one',
        locale: 'en',
        guard: null,
      });
    });

    it('lets next-intl add the locale first when it is missing', () => {
      expect(admin('/merchants')).toEqual({ kind: 'intl', locale: null, guard: null });
      expect(admin('/')).toEqual({ kind: 'intl', locale: null, guard: null });
    });

    it('refuses explicit /admin paths so the tree cannot be nested', () => {
      expect(admin('/zh-CN/admin/merchants')).toEqual({ kind: 'notFound' });
    });

    it('matches the host case-insensitively', () => {
      expect(routeHost('ADMIN.localhost:3800', '/en/orders', cfg)).toMatchObject({ kind: 'rewrite' });
    });
  });

  it('passes API calls through on both hosts', () => {
    expect(main('/api/v1/me')).toEqual({ kind: 'pass' });
    expect(admin('/api/v1/me')).toEqual({ kind: 'pass' });
  });
});
