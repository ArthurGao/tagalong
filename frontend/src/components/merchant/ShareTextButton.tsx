'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { components } from '@/lib/api/schema';
import { copyText } from '@/lib/clipboard';
import { shareText } from '@/lib/share-text';

type Summary = components['schemas']['ListingSummaryDto'];

/** Copies the group-chat message for a listing (DESIGN §11), with the link on this site's own address. */
export function ShareTextButton({ listing }: { listing: Summary }) {
  const t = useTranslations('listings.share');
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const url = `${window.location.origin}/${locale}/l/${listing.shortCode}`;
    setCopied(await copyText(shareText(listing, url, locale, t)));
  };
  return (
    <button type="button" onClick={copy} className="min-h-11 py-3 text-sm underline">
      {copied ? <span role="status">{t('copied')}</span> : t('button')}
    </button>
  );
}
