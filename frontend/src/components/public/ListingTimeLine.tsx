'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatNzDateTime } from '@/lib/time';
import { Countdown } from './Countdown';
import { useLiveListing } from './live-listing';

/** "Opens …" before opening, "Closed …" once closed or cancelled, otherwise a countdown to the deadline. */
export function ListingTimeLine() {
  const t = useTranslations('public.listing');
  const locale = useLocale();
  const l = useLiveListing();
  let line: React.ReactNode = null;
  if (l.availability === 'NOT_YET_OPEN' && l.opensAt) {
    line = t('opensAt', { date: formatNzDateTime(l.opensAt, locale) });
  } else if (l.closesAt && (l.availability === 'CLOSED' || l.availability === 'CANCELLED')) {
    line = t('closedAt', { date: formatNzDateTime(l.closesAt, locale) });
  } else if (l.closesAt) {
    line = <Countdown until={l.closesAt} />;
  }
  return line && <p className="text-sm tabular-nums text-muted-foreground">{line}</p>;
}
