import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

// A missing listing, order or merchant (DESIGN §11), in the buyer's language and the public style, with a way on.
export async function NotFoundView() {
  const [t, locale] = await Promise.all([getTranslations('public.notFound'), getLocale()]);
  return (
    <main className="mx-auto flex max-w-[480px] flex-col gap-4 px-4 py-16">
      <h1 className="font-display text-[28px] font-bold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('body')}</p>
      <div className="flex flex-wrap gap-4">
        <Link href={`/${locale}`} className="inline-flex min-h-11 items-center underline">
          {t('home')}
        </Link>
        <Link href={`/${locale}/find-order`} className="inline-flex min-h-11 items-center underline">
          {t('findOrder')}
        </Link>
      </div>
    </main>
  );
}
