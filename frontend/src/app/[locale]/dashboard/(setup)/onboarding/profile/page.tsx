import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProfileForm } from '@/components/merchant/ProfileForm';
import { requireMerchant } from '@/lib/api/server';

export default async function ProfileOnboardingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await requireMerchant(locale);
  if (me.hasMerchantProfile) redirect(`/${locale}/dashboard`);
  const t = await getTranslations('onboarding');

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('intro')}</p>
      <ProfileForm defaultEmail={me.email} />
    </main>
  );
}
