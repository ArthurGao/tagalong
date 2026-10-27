import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NewListingForm } from '@/components/merchant/NewListingForm';

export default async function NewListingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('listings');
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-bold">{t('newTitle')}</h1>
      <p className="text-muted-foreground">{t('newIntro')}</p>
      <NewListingForm />
    </main>
  );
}
