'use client';

import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * Every admin write asks why (kept in the audit log); destructive ones also make the admin type the merchant's slug
 * (UI-STYLE §4). `onConfirm` returns whether it worked: the dialog stays open on failure so the error is visible.
 */
export function ConfirmWithReason({
  label,
  title,
  body,
  confirmText,
  danger = false,
  error,
  busy = false,
  extra,
  onConfirm,
}: {
  label: string;
  title: string;
  body: string;
  /** Text the admin must type to enable the button (the merchant's slug), for destructive actions. */
  confirmText?: string;
  danger?: boolean;
  error?: string | null;
  busy?: boolean;
  /** More fields between the reason and the buttons (e.g. "refund everyone"). */
  extra?: ReactNode;
  onConfirm: (reason: string) => Promise<boolean>;
}) {
  const t = useTranslations('admin.confirm');
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const ready = reason.trim().length > 0 && (!confirmText || typed.trim() === confirmText);

  const submit = async () => {
    if (await onConfirm(reason.trim())) {
      setOpen(false);
      setReason('');
      setTyped('');
    }
  };

  return (
    <>
      <Button type="button" size="sm" variant={danger ? 'destructive' : 'outline'} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{body}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-reason`}>{t('reason')}</Label>
            <Textarea id={`${id}-reason`} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {extra}
          {confirmText && (
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-confirm`}>{t('typeToConfirm', { text: confirmText })}</Label>
              <Input id={`${id}-confirm`} className="font-mono" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="button" size="sm" variant={danger ? 'destructive' : 'default'} disabled={!ready || busy} onClick={submit}>
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
