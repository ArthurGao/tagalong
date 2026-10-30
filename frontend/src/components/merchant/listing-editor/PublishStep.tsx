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
import { CancelListing, CancellationProgress, type Progress } from '../CancelListing';
import { DateTimeField } from './DateTimeField';
import { listingShareUrl } from '@/lib/share-text';

// Backend publish-check details → listings.missing.* keys (next-intl keys cannot contain dots).
const MISSING_KEYS: Record<string, string> = {
  title: 'title',
  policyText: 'policyText',
  options: 'options',
  'options.startsAt': 'optionsStartsAt',
  closesAt: 'closesAt',
  pickupPoints: 'pickupPoints',
};

export function PublishStep({ listing, onSaved }: StepProps) {
  const t = useTranslations('listings.publish');
  const tMissing = useTranslations('listings.missing');
  const locale = useLocale();
  const save = useSave();
  const tListings = useTranslations('listings');
  const [reopenUntil, setReopenUntil] = useState('');
  // What the cancel answered, so the progress line shows at once instead of after a first fetch.
  const [cancelled, setCancelled] = useState<Progress>();
  const reopenAt = reopenUntil ? nzInputToIso(reopenUntil) : null;
  const reopenInvalid = Boolean(reopenUntil) && reopenAt === null; // a time skipped by daylight saving
  const path = { params: { path: { id: listing.id } } };
  const shareUrl = listingShareUrl(typeof window === 'undefined' ? '' : window.location.origin, listing.shortCode);
  const missing = save.details.flatMap((d) => MISSING_KEYS[d] ?? []);

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
          <DateTimeField
            id="reopenUntil"
            label={t('reopenUntil')}
            error={reopenInvalid ? tListings('timeInvalid') : undefined}
            value={reopenUntil}
            onChange={(e) => setReopenUntil(e.target.value)}
          />
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
      {(listing.status === 'PUBLISHED' || listing.status === 'CLOSED') && (
        <CancelListing listingId={listing.id} title={listing.title} onCancelled={(p) => {
            setCancelled(p);
            onSaved({ ...listing, status: 'CANCELLED' });
          }} />
      )}
      {listing.status === 'CANCELLED' && (
        <>
          <p>{t('cancelled')}</p>
          <CancellationProgress listingId={listing.id} initial={cancelled} />
        </>
      )}
      {save.error && (
        <div role="alert" className="text-sm text-destructive">
          <p>{save.error}</p>
          {missing.length > 0 && <p>{t('missing', { items: missing.map((m) => tMissing(m)).join(', ') })}</p>}
        </div>
      )}
    </div>
  );
}
