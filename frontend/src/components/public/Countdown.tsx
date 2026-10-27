'use client';

import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';

const TICK_MS = 30_000;
const subscribe = (onTick: () => void) => {
  const timer = setInterval(onTick, TICK_MS);
  return () => clearInterval(timer);
};
// Rounded to the tick so getSnapshot is stable between ticks; null on the server so both renders agree.
const clientNow = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const serverNow = () => null;

// Cosmetic only: the backend decides when a listing is closed (DESIGN §5b).
export function Countdown({ until }: { until: string }) {
  const t = useTranslations('public.listing');
  const now = useSyncExternalStore(subscribe, clientNow, serverNow);
  if (now === null) return null;
  const left = Math.max(0, new Date(until).getTime() - now);
  const d = Math.floor(left / 86_400_000);
  const h = Math.floor((left % 86_400_000) / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const time = d > 0 ? t('countdown.days', { d, h }) : h > 0 ? t('countdown.hours', { h, m }) : t('countdown.minutes', { m });
  return <span>{t('closesIn', { time })}</span>;
}
