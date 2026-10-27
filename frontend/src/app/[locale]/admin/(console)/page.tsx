import { getTranslations, setRequestLocale } from 'next-intl/server';

export default async function AdminOverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('admin.home');

  return (
    <main className="flex flex-col gap-4 px-6 py-6">
      <h1 className="text-lg font-semibold">{t('title')}</h1>
      <p className="rounded-[var(--radius)] border border-border bg-card p-4 text-muted-foreground">
        {t('placeholder')}
      </p>
    </main>
  );
}
