import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StripeStatusCard } from '@/components/merchant/StripeStatusCard';
import { Button } from '@/components/ui/button';
import { getMyMerchant } from '@/lib/api/server';

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, merchant] = await Promise.all([getTranslations('dashboard.home'), getMyMerchant()]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      {merchant && (
        <StripeStatusCard
          locale={locale}
          stripeConnected={merchant.stripeConnected}
          chargesEnabled={merchant.chargesEnabled}
        />
      )}
      <section className="flex flex-col items-start gap-4 rounded-[var(--radius)] border border-border bg-card p-6">
        <p className="text-muted-foreground">{t('empty')}</p>
        <Button>{t('create')}</Button>
      </section>
    </main>
  );
}
