import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import zh from '../../messages/zh-CN.json';
import type { components } from '@/lib/api/schema';
import { shareText } from './share-text';

type Summary = components['schemas']['ListingSummaryDto'];

// A translator over the real catalogs, as next-intl would format them.
const translator = (catalog: Record<string, string>) => (key: string, values: Record<string, string | number> = {}) =>
  catalog[key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));

const listing = (over: Partial<Summary> = {}, share: Partial<Summary['share']> = {}): Summary => ({
  id: 'l1', shortCode: 'abc12345', title: '车厘子 2kg', status: 'PUBLISHED', pricing: 'PAID', type: 'RETAIL', soldCount: 23, totalCapacity: 30,
  closesAt: null, createdAt: '2026-10-01T00:00:00Z',
  share: { minPriceCents: 3900, maxPriceCents: 3900, remaining: 7, place: 'Albany', startsAt: null, ...share },
  ...over,
});
const URL = 'https://tagalong.nz/zh-CN/l/abc12345';

describe('share text (DESIGN §11)', () => {
  it('writes the group-chat message in Chinese', () => {
    expect(shareText(listing(), URL, 'zh-CN', translator(zh.listings.share))).toBe(
      `【接龙】车厘子 2kg $39.00 | Albany\n已接龙 23 人，剩 7 份 👉 ${URL}`,
    );
  });

  it('and in English, with a price range and no count when places are unlimited', () => {
    const text = shareText(listing({ title: 'Cherries' }, { maxPriceCents: 5900, remaining: null }), URL, 'en', translator(en.listings.share));
    expect(text).toBe(`[Group buy] Cherries from $39.00 | Albany\n23 joined 👉 ${URL}`);
  });

  it('says free and registered for a free event, with its time', () => {
    const text = shareText(
      listing({ title: 'Yoga', pricing: 'FREE', soldCount: 4 }, { minPriceCents: 0, maxPriceCents: 0, remaining: 6, place: 'Albany Hall', startsAt: '2026-11-07T20:30:00Z' }),
      URL,
      'en',
      translator(en.listings.share),
    );
    expect(text).toBe(`[Sign-up] Yoga Free | 8 Nov 2026, 09:30 Albany Hall\n4 registered, 6 left 👉 ${URL}`);
  });
});
