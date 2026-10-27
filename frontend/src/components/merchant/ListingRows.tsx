import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { components } from '@/lib/api/schema';
import { formatNzDateTime } from '@/lib/time';
import { ShareTextButton } from './ShareTextButton';

type Summary = components['schemas']['ListingSummaryDto'];

// UI-STYLE §3: lists, not card grids; every status has a text label.
export async function ListingRows({ listings, locale }: { listings: Summary[]; locale: string }) {
  const t = await getTranslations('listings');
  return (
    <ul className="divide-y divide-border rounded-[var(--radius)] border border-border bg-card">
      {listings.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center gap-2 pr-4">
          <Link
            href={`/${locale}/dashboard/listings/${l.id}/edit`}
            className="flex min-h-14 flex-1 flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted"
          >
            <span className="font-bold">{l.title}</span>
            <span className="flex flex-wrap gap-3 text-sm text-muted-foreground tabular-nums">
              <span>{t(`status.${l.status}`)}</span>
              <span>{t(`pricing.${l.pricing}`)}</span>
              <span>
                {l.totalCapacity === null
                  ? t('sold', { sold: l.soldCount })
                  : t('soldOf', { sold: l.soldCount, capacity: l.totalCapacity })}
              </span>
              {l.closesAt && <span>{t('closes', { date: formatNzDateTime(l.closesAt, locale) })}</span>}
            </span>
          </Link>
          {l.status !== 'DRAFT' && (
            <Link href={`/${locale}/dashboard/listings/${l.id}/orders`} className="min-h-11 py-3 text-sm underline">
              {t(l.pricing === 'FREE' ? 'registrations' : 'orders')}
            </Link>
          )}
          {l.status === 'PUBLISHED' && <ShareTextButton listing={l} />}
        </li>
      ))}
    </ul>
  );
}
