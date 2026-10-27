import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';

// Full-dashboard (Standard) accounts have no login link; merchants sign in to Stripe directly.
const STRIPE_DASHBOARD_URL = 'https://dashboard.stripe.com/';

// Stripe to-do (DESIGN §11): free listings work without Stripe (D12); paid ones need chargesEnabled.
export async function StripeStatusCard({
  locale,
  stripeConnected,
  chargesEnabled,
}: {
  locale: string;
  stripeConnected: boolean;
  chargesEnabled: boolean;
}) {
  const t = await getTranslations('stripe');
  const state = chargesEnabled ? 'connected' : stripeConnected ? 'pending' : 'todo';
  return (
    <section className="flex flex-col items-start gap-3 rounded-[var(--radius)] border border-border bg-card p-6">
      <h2 className="text-lg font-bold">{t(`${state}Title`)}</h2>
      <p className="text-muted-foreground">{t(`${state}Body`)}</p>
      {state === 'connected' ? (
        <Button variant="outline" asChild>
          <a href={STRIPE_DASHBOARD_URL} target="_blank" rel="noopener noreferrer">
            {t('openDashboard')}
          </a>
        </Button>
      ) : (
        <Button asChild>
          <Link href={`/${locale}/dashboard/onboarding`}>{state === 'pending' ? t('continue') : t('start')}</Link>
        </Button>
      )}
    </section>
  );
}
