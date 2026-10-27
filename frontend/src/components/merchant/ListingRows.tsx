import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { components } from '@/lib/api/schema';
import { formatNzDateTime } from '@/lib/time';

type Summary = components['schemas']['ListingSummaryDto'];

// UI-STYLE §3: lists, not card grids; every status has a text label.
export async function ListingRows({ listings, locale }: { listings: Summary[]; locale: string }) {
  const t = await getTranslations('listings');
  return (
    <ul className="divide-y divide-border rounded-[var(--radius)] border border-border bg-card">
      {listings.map((l) => (
        <li key={l.id}>
          <Link
            href={`/${locale}/dashboard/listings/${l.id}/edit`}
            className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted"
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
        </li>
      ))}
    </ul>
  );
}
