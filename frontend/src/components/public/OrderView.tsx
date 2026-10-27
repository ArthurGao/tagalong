'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api/client';
import { fetchOrder, fetchOrderCalendar, type PublicOrder } from '@/lib/api/public';
import { useSave } from '@/lib/api/use-save';
import { saveFile } from '@/lib/download';
import { formatCents } from '@/lib/money';
import { statusKey } from '@/lib/order-status';
import { formatNzDateTime } from '@/lib/time';
import { Section } from './Section';

const CONFIRM_POLL_MS = 2_000;
const CONFIRM_TIMEOUT_MS = 60_000;

/**
 * Back from Stripe (`paid=1`) while the webhook has not landed yet: poll every 2 s for up to 60 s, then say the
 * payment was submitted. Never "unpaid" in that window (DESIGN §11).
 */
function useConfirming(initial: PublicOrder, token: string, paid: boolean) {
  const [order, setOrder] = useState(initial);
  const [timedOut, setTimedOut] = useState(false);
  const waiting = paid && order.status === 'PENDING_PAYMENT' && !timedOut;
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - started >= CONFIRM_TIMEOUT_MS) {
        clearInterval(timer);
        setTimedOut(true);
        return;
      }
      try {
        const fresh = await fetchOrder(initial.publicCode, token);
        if (fresh) setOrder(fresh);
      } catch {
        // a failed poll just waits for the next one
      }
    }, CONFIRM_POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, initial.publicCode, token]);
  return { order, setOrder, waiting };
}

export function OrderView({ initial, token, paid }: { initial: PublicOrder; token: string; paid: boolean }) {
  const t = useTranslations('public.order');
  const locale = useLocale();
  const { order, setOrder, waiting } = useConfirming(initial, token, paid);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const save = useSave();

  const cancel = async () => {
    const updated = await save.run(() =>
      api.POST('/api/v1/public/orders/{publicCode}/cancel', {
        params: { path: { publicCode: order.publicCode }, header: { 'X-Order-Token': token } },
      }),
    );
    if (updated) {
      setOrder(updated);
      setConfirmCancel(false);
    }
  };

  const addToCalendar = async () => {
    const ics = await fetchOrderCalendar(order.publicCode, token).catch(() => null);
    if (ics) saveFile(`tagalong-${order.publicCode}.ics`, ics, 'text/calendar');
  };

  const pending = order.status === 'PENDING_PAYMENT';
  const free = order.isFree;
  const statusLabel = t(`status.${statusKey(order)}`);
  // The headline, and whether the plain status label is worth adding under it.
  let headline = statusLabel;
  let showStatus = false;
  if (pending && paid) headline = waiting ? t('confirming') : t('submitted'); // never "unpaid" here
  else if ((order.status === 'PAID' || order.status === 'CONFIRMED' || order.status === 'FULFILLED') && order.sequenceNo) {
    [headline, showStatus] = [t(free ? 'registeredHeadline' : 'paidHeadline', { seq: order.sequenceNo }), true];
  } else if (order.status === 'EXPIRED') {
    [headline, showStatus] = [order.refundedCents > 0 ? t('autoRefunded') : t('expiredBody'), true];
  }

  return (
    <main className="mx-auto flex max-w-[480px] flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">{t(free ? 'titleFree' : 'title', { code: order.publicCode })}</p>
        <h1 className="font-display text-[28px] leading-tight font-bold">{order.listing.title}</h1>
        <p role="status" aria-live="polite" className="font-display text-xl font-semibold">
          {headline}
        </p>
        {order.canCancel && order.selfCancelUntil && (
          <p className="text-sm text-muted-foreground">
            {t('cancelUntil', { time: formatNzDateTime(order.selfCancelUntil, locale) })}
          </p>
        )}
        {pending && !paid && order.reservationExpiresAt && (
          <p className="text-sm text-muted-foreground">
            {t('held', { time: formatNzDateTime(order.reservationExpiresAt, locale) })}
          </p>
        )}
        {showStatus && <p className="text-sm text-muted-foreground">{statusLabel}</p>}
      </header>
      <Section title={t('itemsTitle')}>
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius)] border border-border bg-card">
          {order.items.map((i, n) => (
            <li key={n} className="flex justify-between gap-4 px-4 py-3">
              <span>
                {i.name} ×{i.quantity}
              </span>
              {!free && <span className="tabular-nums">{formatCents(i.unitPriceCents * i.quantity)}</span>}
            </li>
          ))}
        </ul>
        {!free && (
          <p className="text-right font-display text-lg font-bold tabular-nums">{t('total', { amount: formatCents(order.totalCents) })}</p>
        )}
        {order.refundedCents > 0 && (
          <p className="text-right text-sm tabular-nums text-muted-foreground">
            {t('refunded', { amount: formatCents(order.refundedCents) })}
          </p>
        )}
      </Section>
      {order.pickupPoint && (
        <Section title={t('pickupTitle')}>
          <p className="font-medium">{order.pickupPoint.label}</p>
          <p className="text-sm text-muted-foreground">{order.pickupPoint.address}</p>
          {order.pickupPoint.notes && <p className="text-sm">{order.pickupPoint.notes}</p>}
        </Section>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/${locale}/l/${order.listing.shortCode}`} className="underline">
          {t('backToListing')}
        </Link>
        {order.hasCalendar && (
          <Button variant="outline" onClick={addToCalendar}>
            {t('addToCalendar')}
          </Button>
        )}
        {order.canCancel && !paid && (
          <Button variant="outline" onClick={() => setConfirmCancel(true)}>
            {t(free ? 'cancelRegistration' : 'cancel')}
          </Button>
        )}
      </div>
      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(free ? 'cancelRegistrationTitle' : 'cancelTitle')}</DialogTitle>
            <DialogDescription>{t(free ? 'cancelRegistrationBody' : 'cancelBody')}</DialogDescription>
          </DialogHeader>
          {save.error && (
            <p role="alert" className="text-sm text-destructive">
              {save.error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCancel(false)}>
              {t('keep')}
            </Button>
            <Button disabled={save.saving} onClick={cancel}>
              {t('cancelConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
