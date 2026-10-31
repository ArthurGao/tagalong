// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import zh from '../../../messages/zh-CN.json';
import { generateMetadata } from '@/app/[locale]/(public)/o/[publicCode]/page';
import { NotFoundView } from './NotFoundView';

// Boundaries: the message catalog behind next-intl's server API, and the backend behind fetchOrder.
const catalogs = { en, 'zh-CN': zh } as const;
let locale: keyof typeof catalogs = 'en';
vi.mock('next-intl/server', () => ({
  getLocale: async () => locale,
  setRequestLocale: () => {},
  getTranslations: async (arg: string | { locale: keyof typeof catalogs; namespace: string }) => {
    const { locale: l, namespace } = typeof arg === 'string' ? { locale, namespace: arg } : arg;
    return createTranslator({ locale: l, messages: catalogs[l], namespace: namespace as never });
  },
}));
const fetchOrder = vi.fn();
vi.mock('@/lib/api/public', () => ({ fetchOrder: (...a: unknown[]) => fetchOrder(...a) }));

afterEach(() => {
  cleanup();
  fetchOrder.mockReset();
});

describe('public 404 (DESIGN §11)', () => {
  it.each(['en', 'zh-CN'] as const)('%s: says the page is missing and offers home and find-my-orders', async (l) => {
    locale = l;
    render(await NotFoundView());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(catalogs[l].public.notFound.title);
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([`/${l}`, `/${l}/find-order`]);
  });
});

describe('order page tab title', () => {
  const props = (t?: string) => ({ params: Promise.resolve({ locale: 'zh-CN', publicCode: 'TA-ABC123' }), searchParams: Promise.resolve({ t }) });

  it('names the listing and the order code, worded for registrations and orders', async () => {
    fetchOrder.mockResolvedValue({ publicCode: 'TA-ABC123', isFree: true, listing: { title: '周六亲子烘焙课' } });
    expect((await generateMetadata(props('tok'))).title).toBe('周六亲子烘焙课 · 报名号 TA-ABC123');
    expect(fetchOrder).toHaveBeenCalledWith('TA-ABC123', 'tok');
    fetchOrder.mockResolvedValue({ publicCode: 'TA-ABC123', isFree: false, listing: { title: '车厘子' } });
    expect((await generateMetadata(props('tok2'))).title).toBe('车厘子 · 订单 TA-ABC123');
  });

  it('says nothing about an order it cannot open (no token, wrong token)', async () => {
    expect(await generateMetadata(props())).toEqual({});
    expect(fetchOrder).not.toHaveBeenCalled();
    fetchOrder.mockResolvedValue(null);
    expect(await generateMetadata(props('wrong'))).toEqual({});
  });
});
