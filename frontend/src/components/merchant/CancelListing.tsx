'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';
import { useSave } from '@/lib/api/use-save';
import { formatCents } from '@/lib/money';

type Preview = components['schemas']['CancellationPreviewDto'];
export type Progress = components['schemas']['CancellationProgressDto'];

const PROGRESS_POLL_MS = 3_000;

/** The batch refund's progress (DESIGN §8.5), polled while it runs. */
export function CancellationProgress({ listingId, initial }: { listingId: string; initial?: Progress }) {
  const t = useTranslations('listings.cancel');
  const [progress, setProgress] = useState<Progress | undefined>(initial);
  const running = !progress || progress.status === 'RUNNING' || progress.status === 'PENDING';
  useEffect(() => {
    if (!running) return;
    const load = async () => {
      try {
        const { data } = await api.GET('/api/v1/merchants/me/listings/{id}/cancellation', { params: { path: { id: listingId } } });
        if (data) setProgress(data);
      } catch {
        // a failed poll just waits for the next one
      }
    };
    if (!initial) void load(); // nothing to show until the first answer
    const timer = setInterval(() => void load(), PROGRESS_POLL_MS);
    return () => clearInterval(timer);
  }, [running, listingId, initial]);
  if (!progress) return null;
  return (
    <p role="status" className="text-sm">
      {t(`progress.${progress.status}`, { succeeded: progress.succeeded, total: progress.totalOrders, failed: progress.failed })}
    </p>
  );
}

/**
 * Cancel the whole listing (DESIGN §8.5): the dialog shows what will happen (orders, refund total, Stripe fees not
 * returned) and asks for the title to be typed before anything happens.
 */
export function CancelListing({ listingId, title, onCancelled }: { listingId: string; title: string; onCancelled: (p: Progress) => void }) {
  const t = useTranslations('listings.cancel');
  const save = useSave();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');

  const openDialog = async () => {
    setPreview(null); // never act on an earlier preview: the numbers may have changed
    setOpen(true);
    const data = await save.run(() => api.GET('/api/v1/merchants/me/listings/{id}/cancellation/preview', { params: { path: { id: listingId } } }));
    if (data) setPreview(data);
  };
  const confirm = async () => {
    const progress = await save.run(() =>
      api.POST('/api/v1/merchants/me/listings/{id}/cancel', { params: { path: { id: listingId } }, body: { reason: reason.trim(), confirmTitle: typed } }),
    );
    if (progress) {
      setOpen(false);
      onCancelled(progress);
    }
  };

  return (
    <>
      <Button variant="outline" className="self-start" onClick={openDialog}>
        {t('button')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('body')}</DialogDescription>
          </DialogHeader>
          {preview && (
            <ul className="flex flex-col gap-1 text-sm">
              <li>{t('paidOrders', { count: preview.paidOrders, amount: formatCents(preview.refundTotalCents) })}</li>
              {preview.registrations > 0 && <li>{t('registrations', { count: preview.registrations })}</li>}
              {preview.unpaidOrders > 0 && <li>{t('unpaid', { count: preview.unpaidOrders })}</li>}
              {preview.paidOrders > 0 && <li className="font-medium">{t('feesNotReturned')}</li>}
            </ul>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="cancelReason">{t('reason')}</Label>
            <Textarea id="cancelReason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="confirmTitle">{t('typeTitle', { title })}</Label>
            <Input id="confirmTitle" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
          {save.error && (
            <p role="alert" className="text-sm text-destructive">
              {save.error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('keep')}
            </Button>
            {/* Only once the merchant has seen what will happen (DESIGN §8.5). */}
            <Button disabled={save.saving || !preview || !reason.trim() || typed.trim() !== title.trim()} onClick={confirm}>
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
