'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatCents } from '@/lib/money';
import { formatNzDateTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useLiveListing } from './live-listing';
import { Section } from './Section';

const LOW_STOCK = 3; // Kōwhai only when places are scarce (UI-STYLE §2)

export function OptionList() {
  const t = useTranslations('public.listing');
  const locale = useLocale();
  const l = useLiveListing();
  return (
    <Section title={t('choose')}>
      <ul className="flex flex-col divide-y divide-border rounded-[var(--radius)] border border-border bg-card">
        {l.options.map((o, i) => (
          <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
            <span className="flex flex-col">
              <span className="font-medium">{o.name}</span>
              {o.startsAt && (
                <span className="text-sm text-muted-foreground">
                  {formatNzDateTime(o.startsAt, locale)}
                  {o.location ? ` · ${o.location}` : ''}
                </span>
              )}
            </span>
            <span className="flex items-baseline gap-3">
              {o.remaining !== null && (
                <span
                  className={cn(
                    'rounded px-1.5 text-sm tabular-nums',
                    o.remaining <= LOW_STOCK ? 'bg-warning text-warning-foreground' : 'text-muted-foreground',
                  )}
                >
                  {t('remaining', { count: o.remaining })}
                </span>
              )}
              <span className="font-display font-bold tabular-nums">
                {l.pricing === 'FREE' ? t('free') : formatCents(o.priceCents)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
