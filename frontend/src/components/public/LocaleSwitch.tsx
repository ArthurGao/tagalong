'use client';

import { useTranslations } from 'next-intl';
import { useLocaleSwitch } from '@/lib/locale-switch';

/** "English" / "中文": the same page in the other language (behaviour in lib/locale-switch). */
export function LocaleSwitch() {
  const t = useTranslations('common');
  const { target, href, onClick } = useLocaleSwitch();
  return (
    <a href={href} lang={target} aria-label={t('switchToLabel')} onClick={onClick} className="inline-flex min-h-11 items-center text-sm underline">
      {t('switchTo')}
    </a>
  );
}
