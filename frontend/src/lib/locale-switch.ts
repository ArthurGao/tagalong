'use client';

import { usePathname } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useSyncExternalStore } from 'react';
import { routing } from '@/i18n/routing';
import { goTo } from '@/lib/navigate';
import { noSubscription } from '@/lib/no-subscription';

export type Locale = (typeof routing.locales)[number];

/** A locale string as one of ours, for API bodies; anything else is the default. */
export function asLocale(locale: string): Locale {
  return routing.locales.find((l) => l === locale) ?? routing.defaultLocale;
}

/** The language a page switches to: the app has two. */
export function otherLocale(locale: string): Locale {
  return locale === 'en' ? 'zh-CN' : 'en';
}

/**
 * The same page in `target`: the locale segment is swapped and the query string kept (the order page's `?t=` token
 * must survive the switch).
 */
export function switchLocalePath(pathname: string, search: string, target: Locale): string {
  const [, first, ...rest] = pathname.split('/');
  const path = (routing.locales as readonly string[]).includes(first) ? rest : [first, ...rest].filter(Boolean);
  return `/${[target, ...path].join('/')}${search}`;
}

/**
 * What each surface's LocaleSwitch needs: the target language, an href with the query (so a new tab or a copied link
 * keeps the order token), and a click that reads the live location. The server renders the href without the query,
 * which the client fills in after hydration.
 */
export function useLocaleSwitch() {
  const target = otherLocale(useLocale());
  const search = useSyncExternalStore(noSubscription, () => window.location.search, () => '');
  const href = switchLocalePath(usePathname(), search, target);
  const onClick = (e: { preventDefault(): void }) => {
    e.preventDefault();
    goTo(switchLocalePath(window.location.pathname, window.location.search, target));
  };
  return { target, href, onClick };
}
