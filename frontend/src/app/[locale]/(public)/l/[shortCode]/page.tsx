import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { cache } from 'react';
import { Countdown } from '@/components/public/Countdown';
import { ImageCarousel } from '@/components/public/ImageCarousel';
import { LiveListingProvider } from '@/components/public/live-listing';
import { Markdown } from '@/components/public/Markdown';
import { OptionList } from '@/components/public/OptionList';
import { RemainingBar } from '@/components/public/RemainingBar';
import { Section } from '@/components/public/Section';
import { SignUpSheet } from '@/components/public/SignUpSheet';
import { StickyBuyBar } from '@/components/public/StickyBuyBar';
import { fetchParticipants, fetchPublicListing, type PublicListing } from '@/lib/api/public';
import { formatNzDateTime } from '@/lib/time';

export const revalidate = 10; // frontend/CLAUDE.md: public listing pages revalidate every 10 s

type Params = Promise<{ locale: string; shortCode: string }>;

// generateMetadata and the page share one backend read per request.
const getListing = cache((shortCode: string) => fetchPublicListing(shortCode, revalidate));

const NOTICE_STATES = ['SUSPENDED', 'CANCELLED'] as const; // TAKEN_DOWN renders its own notice-only page

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { shortCode } = await params;
  const listing = await getListing(shortCode);
  if (!listing) return {};
  if (listing.availability === 'TAKEN_DOWN') return { robots: { index: false, follow: false } };
  const description = listing.description.slice(0, 160);
  return {
    title: listing.title,
    description,
    // D15: listings stay out of search engines unless the merchant opts in
    robots: listing.indexable ? undefined : { index: false, follow: false },
    openGraph: { title: listing.title, description, type: 'website' },
  };
}

export default async function ListingPage({ params }: { params: Params }) {
  const { locale, shortCode } = await params;
  setRequestLocale(locale);
  // In parallel; the participants endpoint 404s (→ null) when the merchant hides the sheet.
  const [listing, participants, t] = await Promise.all([
    getListing(shortCode),
    fetchParticipants(shortCode, undefined, revalidate),
    getTranslations('public.listing'),
  ]);
  if (!listing) notFound();
  if (listing.availability === 'TAKEN_DOWN') {
    // The backend sends none of a taken-down listing's content; show only the notice.
    return (
      <main className="mx-auto flex max-w-[480px] flex-col gap-2 px-4 py-10">
        <p role="status" className="font-display text-xl font-semibold">
          {t('stateNotice.TAKEN_DOWN')}
        </p>
        <p className="text-muted-foreground">{t('by', { merchant: listing.merchant.displayName })}</p>
      </main>
    );
  }
  const notice = NOTICE_STATES.find((s) => s === listing.availability);

  return (
    <LiveListingProvider initial={{ listing, participants }}>
      <main className="mx-auto flex max-w-[480px] flex-col gap-6 px-4 pt-4 pb-32">
        {notice && (
          <p role="status" className="rounded-[var(--radius)] border border-border bg-muted px-4 py-3">
            {t(`stateNotice.${notice}`)}
          </p>
        )}
        <ImageCarousel images={listing.images} title={listing.title} />
        <header className="flex flex-col gap-2">
          <h1 className="font-display text-[28px] leading-tight font-bold">{listing.title}</h1>
          <p className="text-muted-foreground">
            {t('by', { merchant: listing.merchant.displayName })}
            {listing.merchant.verified && <span className="ml-2 text-sm text-foreground">✓ {t('verified')}</span>}
          </p>
        </header>
        <RemainingBar />
        <p className="text-sm tabular-nums text-muted-foreground">{timeLine(listing, locale, t)}</p>
        <OptionList />
        {listing.pickupPoints.length > 0 && (
          <Section title={t('pickupTitle')}>
            <ul className="flex flex-col gap-3">
              {listing.pickupPoints.map((p, i) => (
                <li key={i} className="flex flex-col">
                  <span className="font-medium">{p.label}</span>
                  <span className="text-sm text-muted-foreground">{p.address}</span>
                  {p.windowStart && p.windowEnd && (
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {t('window', {
                        start: formatNzDateTime(p.windowStart, locale),
                        end: formatNzDateTime(p.windowEnd, locale),
                      })}
                    </span>
                  )}
                  {p.notes && <span className="text-sm">{p.notes}</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {listing.description && (
          <Section title={t('detailsTitle')}>
            <Markdown>{listing.description}</Markdown>
          </Section>
        )}
        {listing.policyText && (
          <Section title={t('policyTitle')}>
            <p className="text-sm whitespace-pre-line text-muted-foreground">{listing.policyText}</p>
          </Section>
        )}
        <SignUpSheet />
      </main>
      <StickyBuyBar />
    </LiveListingProvider>
  );
}

/** "Opens …" before opening, a live countdown while open, "Closed …" afterwards. */
function timeLine(listing: PublicListing, locale: string, t: Awaited<ReturnType<typeof getTranslations<'public.listing'>>>) {
  if (listing.availability === 'NOT_YET_OPEN' && listing.opensAt) {
    return t('opensAt', { date: formatNzDateTime(listing.opensAt, locale) });
  }
  if (!listing.closesAt) return null;
  if (listing.availability === 'OPEN') return <Countdown until={listing.closesAt} />;
  return t('closedAt', { date: formatNzDateTime(listing.closesAt, locale) });
}
