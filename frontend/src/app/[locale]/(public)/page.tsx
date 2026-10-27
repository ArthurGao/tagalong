import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { formatCents } from '@/lib/money';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('public.home');

  return (
    <main className="mx-auto flex max-w-[480px] flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-[28px] font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('tagline')}</p>
      </header>
      <section className="flex flex-col gap-3 rounded-[var(--radius)] border border-border bg-card p-4">
        <p className="font-display text-xl font-semibold">{t('sampleListing')}</p>
        <p className="font-display text-[32px] font-bold tabular-nums">{formatCents(3900)}</p>
        <p className="text-muted-foreground">{t('sampleJoined', { count: 23 })}</p>
        <Button size="lg">{t('join')}</Button>
      </section>
    </main>
  );
}
