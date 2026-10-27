'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api/client';
import { formatNzDateTime, nzInputToIso } from '@/lib/time';
import type { Listing, StepProps } from './types';
import { useSave } from '@/lib/api/use-save';

const MISSING_KEYS = ['title', 'policyText', 'options', 'options.startsAt', 'closesAt', 'pickupPoints'];

export function PublishStep({ listing, onSaved }: StepProps) {
  const t = useTranslations('listings.publish');
  const tMissing = useTranslations('listings.missing');
  const locale = useLocale();
  const save = useSave();
  const tListings = useTranslations('listings');
  const [reopenUntil, setReopenUntil] = useState('');
  const reopenAt = reopenUntil ? nzInputToIso(reopenUntil) : null;
  const reopenInvalid = Boolean(reopenUntil) && reopenAt === null; // a time skipped by daylight saving
  const path = { params: { path: { id: listing.id } } };
  const shareUrl = `${typeof window === 'undefined' ? '' : window.location.origin}/l/${listing.shortCode}`;
  const missing = save.details.filter((d) => MISSING_KEYS.includes(d));

  const act = async (call: () => Promise<{ data?: Listing }>) => {
    const updated = await save.run(call);
    if (updated) onSaved(updated);
  };

  return (
    <div className="flex flex-col gap-4">
      {listing.status === 'DRAFT' && (
        <>
          <p>{t('ready')}</p>
          <Button
            className="self-start"
            disabled={save.saving}
            onClick={() => act(() => api.POST('/api/v1/merchants/me/listings/{id}/publish', path))}
          >
            {save.saving ? t('publishing') : t('publish')}
          </Button>
        </>
      )}
      {listing.status === 'PUBLISHED' && (
        <>
          <p>{t('live', { date: formatNzDateTime(listing.publishedAt ?? listing.createdAt, locale) })}</p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="shareUrl">{t('shareLink')}</Label>
            <Input id="shareUrl" readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
          </div>
          <Button
            variant="outline"
            className="self-start"
            disabled={save.saving}
            onClick={() => act(() => api.POST('/api/v1/merchants/me/listings/{id}/close', path))}
          >
            {t('close')}
          </Button>
        </>
      )}
      {listing.status === 'CLOSED' && (
        <>
          <p>{t('closed')}</p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="reopenUntil">{t('reopenUntil')}</Label>
            <Input
              id="reopenUntil"
              type="datetime-local"
              value={reopenUntil}
              aria-invalid={reopenInvalid}
              onChange={(e) => setReopenUntil(e.target.value)}
            />
            {reopenInvalid && (
              <p role="alert" className="text-sm text-destructive">
                {tListings('timeInvalid')}
              </p>
            )}
          </div>
          <Button
            className="self-start"
            disabled={save.saving || reopenInvalid}
            onClick={() =>
              act(() =>
                api.POST('/api/v1/merchants/me/listings/{id}/reopen', {
                  ...path,
                  body: reopenAt ? { closesAt: reopenAt } : {},
                }),
              )
            }
          >
            {t('reopen')}
          </Button>
        </>
      )}
      {listing.status === 'CANCELLED' && <p>{t('cancelled')}</p>}
      {save.error && (
        <div role="alert" className="text-sm text-destructive">
          <p>{save.error}</p>
          {missing.length > 0 && <p>{t('missing', { items: missing.map((m) => tMissing(m)).join(', ') })}</p>}
        </div>
      )}
    </div>
  );
}
