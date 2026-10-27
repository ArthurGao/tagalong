import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { PublicMerchant } from '@/lib/api/public';
import { priceLabel } from '@/lib/money';
import { formatNzDateTime } from '@/lib/time';

/** A merchant's listings on its public page: title, price, whether it still takes orders. */
export function MerchantListings({ listings }: { listings: PublicMerchant['listings'] }) {
  const t = useTranslations('public');
  const locale = useLocale();
  if (!listings.length) return <p className="text-muted-foreground">{t('merchant.empty')}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border rounded-[var(--radius)] border border-border bg-card">
      {listings.map((l) => {
        const price = priceLabel(l.pricing, [l.minPriceCents, l.maxPriceCents].filter((c) => c !== null), {
          free: t('listing.free'),
          from: (p) => t('listing.priceFrom', { price: p }),
        });
        const open = l.availability === 'OPEN';
        return (
          <li key={l.shortCode}>
            <Link href={`/${locale}/l/${l.shortCode}`} className="flex min-h-16 gap-3 px-4 py-3 hover:bg-muted">
              {l.coverImageUrl && (
                // Merchant uploads, served from object storage; sized by the box.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.coverImageUrl} alt="" className="size-14 shrink-0 rounded-[var(--radius)] object-cover" />
              )}
              <span className="flex flex-1 flex-col gap-1">
                <span className="font-medium">{l.title}</span>
                <span className="flex flex-wrap gap-x-3 text-sm text-muted-foreground tabular-nums">
                  <span className="font-display font-semibold text-foreground">{price}</span>
                  <span>{open ? t('merchant.open') : t(`listing.state.${l.availability}`)}</span>
                  {open && l.closesAt && <span>{t('merchant.closes', { date: formatNzDateTime(l.closesAt, locale) })}</span>}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
