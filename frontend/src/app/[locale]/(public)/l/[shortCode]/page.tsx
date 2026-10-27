import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { cache } from 'react';
import { ImageCarousel } from '@/components/public/ImageCarousel';
import { ListingTimeLine } from '@/components/public/ListingTimeLine';
import { LiveListingProvider } from '@/components/public/live-listing';
import { Markdown } from '@/components/public/Markdown';
import { OptionList } from '@/components/public/OptionList';
import { RemainingBar } from '@/components/public/RemainingBar';
import { Section } from '@/components/public/Section';
import { SignUpSheet } from '@/components/public/SignUpSheet';
import { StickyBuyBar } from '@/components/public/StickyBuyBar';
import { AvailabilityGate } from '@/components/public/AvailabilityGate';
import { fetchParticipants, fetchPublicListing } from '@/lib/api/public';
import { formatNzDateTime } from '@/lib/time';

export const revalidate = 10; // frontend/CLAUDE.md: public listing pages revalidate every 10 s

type Params = Promise<{ locale: string; shortCode: string }>;

// generateMetadata and the page share one backend read per request.
const getListing = cache((shortCode: string) => fetchPublicListing(shortCode, revalidate));

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, shortCode } = await params;
  const listing = await getListing(shortCode);
  if (!listing) return {};
  if (listing.availability === 'TAKEN_DOWN') {
    const t = await getTranslations({ locale, namespace: 'public.listing' });
    return { title: t('stateNotice.TAKEN_DOWN'), robots: { index: false, follow: false } };
  }
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

  return (
    <LiveListingProvider initial={{ listing, participants }}>
      <AvailabilityGate>
        <main className="mx-auto flex max-w-[480px] flex-col gap-6 px-4 pt-4 pb-32">
          <ImageCarousel images={listing.images} title={listing.title} />
          <header className="flex flex-col gap-2">
            <h1 className="font-display text-[28px] leading-tight font-bold">{listing.title}</h1>
            <p className="text-muted-foreground">
              {t('by', { merchant: listing.merchant.displayName })}
              {listing.merchant.verified && <span className="ml-2 text-sm text-foreground">✓ {t('verified')}</span>}
            </p>
          </header>
          <RemainingBar />
          <ListingTimeLine />
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
      </AvailabilityGate>
    </LiveListingProvider>
  );
}

