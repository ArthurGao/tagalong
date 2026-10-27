import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StripeStatusCard } from '@/components/merchant/StripeStatusCard';
import { Button } from '@/components/ui/button';
import { getMerchantWithLiveStripe } from '@/lib/api/server';

// Stripe sends the merchant here after onboarding; the backend re-reads the live account first.
export default async function StripeReturnPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, merchant] = await Promise.all([getTranslations('stripe'), getMerchantWithLiveStripe()]);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-bold">{t('returnTitle')}</h1>
      {merchant && (
        <StripeStatusCard locale={locale} stripeConnected={merchant.stripeConnected} chargesEnabled={merchant.chargesEnabled} />
      )}
      <Button variant="outline" asChild className="self-start">
        <Link href={`/${locale}/dashboard`}>{t('backToDashboard')}</Link>
      </Button>
    </main>
  );
}
