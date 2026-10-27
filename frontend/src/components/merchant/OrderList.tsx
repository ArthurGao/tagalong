'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';
import { useSave } from '@/lib/api/use-save';
import { statusKey } from '@/lib/order-status';
import { formatNzDateTime } from '@/lib/time';

type OrderListData = components['schemas']['MerchantOrderListDto'];
type Order = components['schemas']['MerchantOrderDto'];
type Action = 'fulfil' | 'no-show';

const answerText = (answers: Record<string, unknown>) =>
  Object.entries(answers)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
    .join(' · ');

// The registration list / order ledger (UI-STYLE §3): rows, every status in words, actions where they apply.
// M6 adds refunds, CSV and the whole-listing cancel.
export function OrderList({ initial }: { initial: OrderListData }) {
  const t = useTranslations('orders');
  const locale = useLocale();
  const save = useSave();
  const [orders, setOrders] = useState(initial.orders);
  const [query, setQuery] = useState('');
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [reason, setReason] = useState('');
  const free = initial.listing.pricing === 'FREE';

  const replace = (updated: Order) => setOrders((list) => list.map((o) => (o.id === updated.id ? updated : o)));
  const act = async (order: Order, action: Action) => {
    const updated = await save.run(() => api.POST(`/api/v1/merchants/me/orders/{id}/${action}`, { params: { path: { id: order.id } } }));
    if (updated) replace(updated);
  };
  const cancel = async () => {
    if (!cancelling) return;
    const updated = await save.run(() =>
      api.POST('/api/v1/merchants/me/orders/{id}/cancel', { params: { path: { id: cancelling.id } }, body: { reason: reason.trim() } }),
    );
    if (updated) {
      replace(updated);
      setCancelling(null);
      setReason('');
    }
  };
  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = await save.run(() =>
      api.GET('/api/v1/merchants/me/listings/{id}/orders', { params: { path: { id: initial.listing.id }, query: query.trim() ? { q: query.trim() } : {} } }),
    );
    if (found) setOrders(found.orders);
  };

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold">{t(free ? 'titleFree' : 'title')}</h1>
        <p className="text-muted-foreground">{initial.listing.title}</p>
      </header>
      <form onSubmit={search} className="flex gap-2" role="search">
        <Label htmlFor="q" className="sr-only">
          {t('search')}
        </Label>
        <Input id="q" value={query} placeholder={t('search')} onChange={(e) => setQuery(e.target.value)} />
        <Button type="submit" variant="outline">
          {t('searchButton')}
        </Button>
      </form>
      {save.error && (
        <p role="alert" className="text-sm text-destructive">
          {save.error}
        </p>
      )}
      {orders.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-[var(--radius)] border border-border bg-card">
          {orders.map((o) => (
            <li key={o.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-bold tabular-nums">
                  {o.sequenceNo ? `#${o.sequenceNo} ` : ''}
                  {o.buyerName}
                </span>
                <span className="text-sm">{t(`status.${statusKey(o)}`)}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {o.items.map((i) => `${i.name} ×${i.quantity}`).join(', ')}
                {o.pickupPointLabel ? ` · ${o.pickupPointLabel}` : ''} · {o.buyerEmail} · {o.buyerPhone}
              </p>
              {Object.keys(o.formAnswers).length > 0 && <p className="text-sm">{answerText(o.formAnswers)}</p>}
              {o.items.flatMap((i) => i.attendeeAnswers).map((a, n) => (
                <p key={n} className="text-sm">
                  {t('attendee', { n: n + 1 })} {answerText(a)}
                </p>
              ))}
              {o.buyerNote && <p className="text-sm italic">{o.buyerNote}</p>}
              <p className="text-xs text-muted-foreground tabular-nums">{formatNzDateTime(o.paidAt ?? o.createdAt, locale)}</p>
              <div className="flex flex-wrap gap-2">
                {o.canFulfil && (
                  <Button size="sm" disabled={save.saving} onClick={() => act(o, 'fulfil')}>
                    {t(o.isFree ? 'checkIn' : 'fulfil')}
                  </Button>
                )}
                {o.canNoShow && (
                  <Button size="sm" variant="outline" disabled={save.saving} onClick={() => act(o, 'no-show')}>
                    {t('noShow')}
                  </Button>
                )}
                {o.canCancel && (
                  <Button size="sm" variant="outline" disabled={save.saving} onClick={() => setCancelling(o)}>
                    {t('cancel')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={cancelling !== null} onOpenChange={(open) => !open && setCancelling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('cancelTitle', { name: cancelling?.buyerName ?? '' })}</DialogTitle>
            <DialogDescription>{t('cancelBody')}</DialogDescription>
          </DialogHeader>
          <Label htmlFor="reason">{t('reason')}</Label>
          <Textarea id="reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)}>
              {t('keep')}
            </Button>
            <Button disabled={!reason.trim() || save.saving} onClick={cancel}>
              {t('confirmCancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
