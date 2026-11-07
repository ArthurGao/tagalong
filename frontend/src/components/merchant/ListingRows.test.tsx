// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { components } from '@/lib/api/schema';
import en from '../../../messages/en.json';
import zh from '../../../messages/zh-CN.json';
import { ListingRows } from './ListingRows';

// Boundary: the message catalog behind next-intl's server API (each locale's real messages).
const catalogs = { en, 'zh-CN': zh } as const;
let locale: keyof typeof catalogs = 'zh-CN';
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => createTranslator({ locale, messages: catalogs[locale], namespace: namespace as never, timeZone: 'Pacific/Auckland' }),
}));
vi.mock('./ShareTextButton', () => ({ ShareTextButton: () => null }));

type Summary = components['schemas']['ListingSummaryDto'];
const row = (over: Partial<Summary>) => ({ id: 'l1', title: 'T', status: 'DRAFT', pricing: 'FREE', soldCount: 3, totalCapacity: null, closesAt: null, ...over }) as Summary;

afterEach(cleanup);

describe('ListingRows (free vs paid wording)', () => {
  it.each([
    ['zh-CN', 'FREE', null, '已报名 3 人'],
    ['zh-CN', 'PAID', null, '已接龙 3 人'],
    ['zh-CN', 'FREE', 6, '已报名 3 / 6'],
    ['en', 'FREE', null, '3 registered'],
    ['en', 'PAID', 6, '3 / 6 joined'],
  ] as const)('%s %s capacity %s → %s', async (l, pricing, totalCapacity, text) => {
    locale = l;
    render(await ListingRows({ listings: [row({ pricing, totalCapacity })], locale: l }));
    expect(screen.getByText(text)).toBeTruthy();
  });
});
