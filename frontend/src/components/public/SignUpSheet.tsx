'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Section } from './Section';
import { formatNzDateTime } from '@/lib/time';
import { useLiveListing, useParticipants } from './live-listing';

// The heart of the page (UI-STYLE §2): the numbered list that keeps growing, newest on top.
export function SignUpSheet() {
  const t = useTranslations('public.listing');
  const locale = useLocale();
  const l = useLiveListing();
  const { data, hasNextPage, fetchNextPage, isFetchingNextPage } = useParticipants();
  if (!l.showParticipants) return null;
  const rows = data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Section title={t(`sheet.${l.pricing}`)}>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t('sheetEmpty')}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border border-y border-border bg-card">
          {rows.map((p) => (
            <li key={p.seq} className="grid grid-cols-[3.5rem_1fr_auto] items-baseline gap-2 px-2 py-2">
              <span className="font-display text-[22px] font-bold tabular-nums">#{p.seq}</span>
              <span className="truncate">{p.anonymous ? t('anonymous') : p.displayName}</span>
              <span className="text-right text-sm text-muted-foreground">
                <span className="block">{p.summary}</span>
                <span className="block tabular-nums">{formatNzDateTime(p.joinedAt, locale)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {hasNextPage && (
        <Button variant="ghost" className="self-center" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
          {t('showMore')}
        </Button>
      )}
    </Section>
  );
}
