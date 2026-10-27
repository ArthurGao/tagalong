import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { LocaleSwitch } from './LocaleSwitch';

// Every public page: find-my-orders (DESIGN §11) and the language switch. Bottom padding clears the sticky buy bar.
export function PublicFooter() {
  const t = useTranslations('public.footer');
  const locale = useLocale();
  return (
    <footer className="mx-auto flex max-w-[480px] flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-4 pt-4 pb-28 text-sm text-muted-foreground">
      <span>{t('about')}</span>
      <span className="flex items-center gap-4">
        <Link href={`/${locale}/find-order`} className="inline-flex min-h-11 items-center underline">
          {t('findOrder')}
        </Link>
        <LocaleSwitch />
      </span>
    </footer>
  );
}
