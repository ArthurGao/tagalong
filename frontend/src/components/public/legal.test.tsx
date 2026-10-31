// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import zh from '../../../messages/zh-CN.json';
import { renderWithIntl } from '@/test/render';
import { LegalDocument } from './LegalDocument';
import { PublicFooter } from './PublicFooter';

// The message catalog is the boundary: the server translator of whichever locale the test picks.
const catalogs = { en, 'zh-CN': zh } as const;
let locale: keyof typeof catalogs = 'en';
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => createTranslator({ locale, messages: catalogs[locale], namespace: namespace as never, timeZone: 'Pacific/Auckland' }),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/en', useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

afterEach(cleanup);

describe('legal pages (DESIGN §10, §11)', () => {
  it.each([
    ['en', 'terms'],
    ['en', 'privacy'],
    ['zh-CN', 'terms'],
    ['zh-CN', 'privacy'],
  ] as const)('%s %s: draft banner, title and every section', async (l, doc) => {
    locale = l;
    render(await LegalDocument({ doc }));
    const legal = catalogs[l].public.legal;
    expect(screen.getByRole('note').textContent).toBe(legal.draft);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(legal[doc].title);
    expect(screen.getByText(l === 'en' ? 'Last updated November 1, 2026' : '最后更新：2026年11月1日')).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(legal[doc].sections.map((s) => s.heading));
  });

  it('says where personal data goes and how long it stays, in both languages', async () => {
    for (const l of ['en', 'zh-CN'] as const) {
      locale = l;
      render(await LegalDocument({ doc: 'privacy' }));
      const text = document.body.textContent ?? '';
      for (const needle of ['Clerk', 'Singapore|新加坡', '12', '20', 'privacy@tagalong.nz']) expect([l, needle, new RegExp(needle).test(text)]).toEqual([l, needle, true]);
      cleanup();
    }
  });

  it('keeps the two languages section for section', () => {
    for (const doc of ['terms', 'privacy'] as const) {
      expect(zh.public.legal[doc].sections.map((s) => s.paragraphs.length)).toEqual(en.public.legal[doc].sections.map((s) => s.paragraphs.length));
    }
  });

  it('links both pages from every public page’s footer', () => {
    renderWithIntl(<PublicFooter />);
    const footer = within(screen.getByRole('contentinfo'));
    expect(footer.getByRole('link', { name: en.public.footer.terms }).getAttribute('href')).toBe('/en/legal/terms');
    expect(footer.getByRole('link', { name: en.public.footer.privacy }).getAttribute('href')).toBe('/en/legal/privacy');
  });
});
