'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect } from 'react';
import { useLiveListing, useServerListing } from './live-listing';

const NOTICE_STATES = ['SUSPENDED', 'CANCELLED'] as const;
// The page revalidates every 10 s and serves the stale copy once while revalidating, so retry just after that.
const RESYNC_MS = 11_000;

/**
 * Availability notices for the whole page, from live (polled) data. A takedown replaces the page at once: admins
 * cannot edit merchant content, only take it down, and the backend then sends none of it. While the polled
 * availability differs from the server-rendered one, the page refreshes, so a restore, resume or reopen brings back
 * the server-rendered content (title, description, pickup) too.
 */
export function AvailabilityGate({ children }: { children: ReactNode }) {
  const t = useTranslations('public.listing');
  const router = useRouter();
  const l = useLiveListing();
  const rendered = useServerListing().availability;
  useEffect(() => {
    if (rendered === l.availability) return;
    router.refresh();
    const timer = setInterval(() => router.refresh(), RESYNC_MS);
    return () => clearInterval(timer);
  }, [rendered, l.availability, router]);

  if (l.availability === 'TAKEN_DOWN') {
    return (
      <main className="mx-auto flex max-w-[480px] flex-col gap-2 px-4 py-10">
        <p role="status" className="font-display text-xl font-semibold">
          {t('stateNotice.TAKEN_DOWN')}
        </p>
        <p className="text-muted-foreground">{t('by', { merchant: l.merchant.displayName })}</p>
      </main>
    );
  }
  const notice = NOTICE_STATES.find((s) => s === l.availability);
  return (
    <>
      {notice && (
        <div className="mx-auto max-w-[480px] px-4 pt-4">
          <p role="status" className="rounded-[var(--radius)] border border-border bg-muted px-4 py-3">
            {t(`stateNotice.${notice}`)}
          </p>
        </div>
      )}
      {children}
    </>
  );
}
