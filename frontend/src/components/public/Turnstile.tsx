'use client';

import { useLocale } from 'next-intl';
import { useEffect, useRef } from 'react';

// Cloudflare's documented always-pass test site key, for local development without a real key (DESIGN §13).
const TEST_SITE_KEY = '1x00000000000000000000AA';
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | undefined;
function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile missing')));
    script.onerror = () => {
      loading = undefined;
      reject(new Error('Turnstile failed to load'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * The human check every public order carries (DESIGN §10). Tokens are single-use: remount it (change its `key`)
 * after each submission; it reports `null` until the new widget hands over a fresh token.
 */
export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const locale = useLocale();
  const callback = useRef(onToken);
  useEffect(() => {
    callback.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;
    callback.current(null); // a fresh widget has no token yet
    loadTurnstile()
      .then((api) => {
        if (cancelled || !ref.current) return;
        widgetId = api.render(ref.current, {
          sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || TEST_SITE_KEY,
          language: locale === 'en' ? 'en' : 'zh-cn',
          callback: (token: string) => callback.current(token),
          'expired-callback': () => callback.current(null),
          'error-callback': () => callback.current(null),
        });
      })
      .catch(() => callback.current(null));
    return () => {
      cancelled = true;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [locale]);

  return <div ref={ref} className="min-h-[65px]" />;
}
