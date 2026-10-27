import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StripeOnboardButton } from '@/components/merchant/StripeButtons';
import { getMyMerchant } from '@/lib/api/server';

export default async function StripeOnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ expired?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [{ expired }, t, merchant] = await Promise.all([searchParams, getTranslations('stripe'), getMyMerchant()]);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-bold">{t('onboardingTitle')}</h1>
      {expired && (
        <p role="alert" className="text-destructive">
          {t('expired')}
        </p>
      )}
      <p className="text-muted-foreground">{t('onboardingIntro')}</p>
      <StripeOnboardButton label={merchant?.stripeConnected ? 'continue' : 'start'} />
    </main>
  );
}
