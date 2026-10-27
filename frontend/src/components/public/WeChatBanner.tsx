'use client';

import { useTranslations } from 'next-intl';
import { useState, useSyncExternalStore } from 'react';
import { copyText } from '@/lib/clipboard';

/**
 * Inside WeChat's browser Apple Pay is unavailable (DESIGN §11): a banner that stays put, saying how to open the page
 * in a real browser, with a copy-link button. The user agent is read only in the browser, so cached HTML stays shared.
 */
export function WeChatBanner() {
  const t = useTranslations('public.wechat');
  // false on the server and in the first client render, then the real answer: no hydration mismatch.
  const inWeChat = useSyncExternalStore(noSubscription, () => /MicroMessenger/i.test(navigator.userAgent), () => false);
  const [copied, setCopied] = useState(false);
  if (!inWeChat) return null;

  // Without clipboard access nothing changes: the address bar still has the link.
  const copy = async () => setCopied(await copyText(window.location.href));

  return (
    <div role="note" className="sticky top-0 z-40 flex flex-col gap-2 border-b border-border bg-warning px-4 py-3 text-sm text-warning-foreground">
      <p>{t('text')}</p>
      <div className="flex items-center gap-3">
        <button type="button" onClick={copy} className="min-h-11 rounded-[var(--radius)] border border-border bg-background px-3 font-medium">
          {t('copy')}
        </button>
        {copied && <span role="status">{t('copied')}</span>}
      </div>
    </div>
  );
}

const noSubscription = () => () => {}; // the user agent never changes
