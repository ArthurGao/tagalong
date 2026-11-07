import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { publicFontVariables } from '@/components/public/fonts';
import { ListingView } from '@/components/public/ListingView';
import { LiveListingProvider } from '@/components/public/live-listing';
import { getListingPreview } from '@/lib/api/server';

export async function generateMetadata() {
  const t = await getTranslations('listings.preview');
  return { title: t('title') };
}

// DESIGN §11: the merchant checks the buyer page before publishing. Same body as /l/[shortCode], on the public
// surface's look, with ordering switched off.
export default async function ListingPreviewPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const [listing, t] = await Promise.all([getListingPreview(id), getTranslations('listings.preview')]);
  if (!listing) notFound();
  return (
    <div data-surface="public" className={`${publicFontVariables} bg-background text-foreground`}>
      <div role="status" className="sticky top-0 z-20 border-b border-border bg-muted px-4 py-2 text-sm text-foreground">
        <div className="mx-auto flex max-w-[480px] items-center justify-between gap-3">
          <span>{t('banner')}</span>
          <Link href={`/${locale}/dashboard/listings/${id}/edit`} className="shrink-0 underline underline-offset-2">
            {t('back')}
          </Link>
        </div>
      </div>
      <LiveListingProvider initial={{ listing, participants: null, preview: true }}>
        <ListingView listing={listing} />
      </LiveListingProvider>
    </div>
  );
}
