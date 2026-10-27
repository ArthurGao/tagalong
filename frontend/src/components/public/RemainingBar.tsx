'use client';

import { useTranslations } from 'next-intl';
import { useLiveListing } from './live-listing';

// The only use of the accent besides the join button (UI-STYLE §2).
export function RemainingBar() {
  const t = useTranslations('public.listing');
  const l = useLiveListing();
  const joined = t(`joined.${l.pricing}`, { count: l.joinedCount });
  if (l.totalCapacity === null) return <p className="tabular-nums text-muted-foreground">{joined}</p>;
  const pct = Math.min(100, Math.round((l.joinedCount / l.totalCapacity) * 100));
  return (
    <div className="flex flex-col gap-1">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={l.totalCapacity}
        aria-valuenow={l.joinedCount}
        aria-label={joined}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <p className="flex justify-between text-sm tabular-nums text-muted-foreground">
        <span>{joined}</span>
        <span>{t('progress', { joined: l.joinedCount, capacity: l.totalCapacity })}</span>
      </p>
    </div>
  );
}
