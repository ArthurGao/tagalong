import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ListingRows } from '@/components/merchant/ListingRows';
import { StripeStatusCard } from '@/components/merchant/StripeStatusCard';
import { Button } from '@/components/ui/button';
import { getMyListings, getMyMerchant } from '@/lib/api/server';

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, merchant, listings] = await Promise.all([getTranslations('listings'), getMyMerchant(), getMyListings()]);
  const newListing = `/${locale}/dashboard/listings/new`;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('listTitle')}</h1>
        {listings.length > 0 && (
          <Button asChild>
            <Link href={newListing}>{t('new')}</Link>
          </Button>
        )}
      </div>
      {merchant && (
        <StripeStatusCard locale={locale} stripeConnected={merchant.stripeConnected} chargesEnabled={merchant.chargesEnabled} />
      )}
      {listings.length ? (
        <ListingRows listings={listings} locale={locale} />
      ) : (
        <section className="flex flex-col items-start gap-4 rounded-[var(--radius)] border border-border bg-card p-6">
          <p className="text-muted-foreground">{t('empty')}</p>
          <Button asChild>
            <Link href={newListing}>{t('createFirst')}</Link>
          </Button>
        </section>
      )}
    </main>
  );
}
