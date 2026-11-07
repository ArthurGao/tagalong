import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { cache } from 'react';
import { ListingView } from '@/components/public/ListingView';
import { LiveListingProvider } from '@/components/public/live-listing';
import { fetchParticipants, fetchPublicListing } from '@/lib/api/public';

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
    return { title: t('stateNotice.TAKEN_DOWN') };
  }
  const description = listing.description.slice(0, 160);
  return {
    title: listing.title,
    description,
    // D15: listings stay out of search engines (the root default) unless the merchant opts in
    ...(listing.indexable && { robots: { index: true, follow: true } }),
    openGraph: { title: listing.title, description, type: 'website' },
  };
}

export default async function ListingPage({ params }: { params: Params }) {
  const { locale, shortCode } = await params;
  setRequestLocale(locale);
  // In parallel; the participants endpoint 404s (→ null) when the merchant hides the sheet.
  const [listing, participants] = await Promise.all([
    getListing(shortCode),
    fetchParticipants(shortCode, undefined, revalidate),
  ]);
  if (!listing) notFound();

  return (
    <LiveListingProvider initial={{ listing, participants }}>
      <ListingView listing={listing} />
    </LiveListingProvider>
  );
}

