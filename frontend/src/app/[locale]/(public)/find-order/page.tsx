import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FindOrderForm } from '@/components/public/FindOrderForm';

export default async function FindOrderPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('public.findOrder');
  return (
    <main className="mx-auto flex max-w-[480px] flex-col gap-4 px-4 py-8">
      <h1 className="font-display text-[28px] font-bold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('intro')}</p>
      <FindOrderForm />
    </main>
  );
}
