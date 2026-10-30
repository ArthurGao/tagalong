import type { components } from '@/lib/api/schema';
import { priceLabel, spanPrices } from '@/lib/money';
import { formatNzDateTime } from '@/lib/time';

type Summary = components['schemas']['ListingSummaryDto'];
type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * The message a merchant pastes into a group chat (DESIGN §11), e.g.
 *   【接龙】车厘子 2kg $39 | 周六 Albany 自提
 *   已接龙 23 人，剩 7 份 👉 https://tagalong.nz/l/abc12345
 * `t` is the `listings.share` translator; every word comes from the message catalogs.
 */
export function shareText(l: Summary, url: string, locale: string, t: Translate): string {
  const { minPriceCents: min, maxPriceCents: max, remaining, place, startsAt } = l.share;
  const price = priceLabel(l.pricing, spanPrices(min, max), { free: t('free'), from: (p) => t('from', { price: p }) });
  const where = [startsAt ? formatNzDateTime(startsAt, locale) : null, place].filter(Boolean).join(' ');
  const head = t('head', { kind: t(`kind${l.pricing}`), title: l.title, price }) + (where ? ` | ${where}` : '');
  const count = t(`joined${l.pricing}`, { count: l.soldCount }) + (remaining === null ? '' : t('left', { count: remaining }));
  return `${head}\n${count} ${t('link', { url })}`;
}

/**
 * A listing's public link for sharing, without a language: each person who opens it gets their own browser's language
 * (the next-intl proxy redirects), whatever the merchant's.
 */
export const listingShareUrl = (origin: string, shortCode: string) => `${origin}/l/${shortCode}`;
