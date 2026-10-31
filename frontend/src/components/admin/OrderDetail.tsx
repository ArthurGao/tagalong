'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';
import { centsToDollarsInput, dollarsToCents, formatCents } from '@/lib/money';
import { statusKey } from '@/lib/order-status';
import { formatNzDateTime } from '@/lib/time';
import { ConfirmWithReason } from './ConfirmWithReason';
import { MaskedPii } from './MaskedPii';
import { useAdminAction } from './use-admin-action';

type Order = components['schemas']['AdminOrderDto'];

/** The order drawer: buyer (masked until revealed), items, refunds, and a refund on the merchant's behalf. */
export function OrderDetail({ order: o }: { order: Order }) {
  const t = useTranslations('admin.orders');
  const tStatus = useTranslations('orders.status');
  const locale = useLocale();
  const action = useAdminAction();
  const amountId = useId();
  const [amount, setAmount] = useState(centsToDollarsInput(o.refundableCents));
  const cents = dollarsToCents(amount);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-1">
        <p>
          {tStatus(statusKey(o))} · <span className="font-mono">{formatCents(o.totalCents)}</span> · {formatNzDateTime(o.createdAt, locale)}
          {o.anonymized && <span className="text-muted-foreground"> · {t('anonymized')}</span>}
          {o.openDispute && <span className="text-destructive"> · {t('dispute')}</span>}
        </p>
        <p>
          <Link className="text-primary underline" href={`/${locale}/listings?id=${o.listing.id}`}>
            {o.listing.title}
          </Link>{' '}
          ·{' '}
          <Link className="text-primary underline" href={`/${locale}/merchants?id=${o.merchant.id}`}>
            {o.merchant.displayName}
          </Link>
        </p>
        {o.refundedCents > 0 && <p>{t('refunded', { amount: formatCents(o.refundedCents) })}</p>}
        {o.pendingRefundCents > 0 && <p>{t('refundPending', { amount: formatCents(o.pendingRefundCents) })}</p>}
        {o.lastRefundFailed && <p className="text-destructive">{t('refundFailed')}</p>}
      </section>

      <MaskedPii key={o.id} orderId={o.id} publicCode={o.publicCode} masked={{ name: o.buyerName, email: o.buyerEmail, phone: o.buyerPhone }} />

      <section>
        <h3 className="mb-1 font-semibold">{t('items')}</h3>
        <ul className="flex flex-col gap-1">
          {o.items.map((i, n) => (
            <li key={n}>
              {i.name} × {i.quantity} · <span className="font-mono">{formatCents(i.unitPriceCents)}</span>
            </li>
          ))}
        </ul>
        {o.pickupPointLabel && (
          <p className="mt-1 text-muted-foreground">
            {t('pickup')}: {o.pickupPointLabel}
          </p>
        )}
      </section>

      <section>
        <h3 className="mb-1 font-semibold">{t('refunds')}</h3>
        {o.refunds.length ? (
          <ul className="flex flex-col gap-1">
            {o.refunds.map((r) => (
              <li key={r.id}>
                <span className="font-mono">{formatCents(r.amountCents)}</span> · {t(`refundStatus.${r.status}`)} · {formatNzDateTime(r.createdAt, locale)}
                {r.reason && <span className="text-muted-foreground"> · {r.reason}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">{t('noRefunds')}</p>
        )}
      </section>

      {o.refundableCents > 0 && (
        <div>
          <ConfirmWithReason
            label={t('refund')}
            title={t('refundTitle', { code: o.publicCode })}
            body={t('refundBody', { amount: formatCents(o.refundableCents) })}
            valid={cents !== null && cents >= 1 && cents <= o.refundableCents}
            extra={
              <div className="flex flex-col gap-1">
                <Label htmlFor={amountId}>{t('refundAmount')}</Label>
                <Input id={amountId} inputMode="decimal" className="font-mono" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
            }
            error={action.error}
            busy={action.busy}
            onConfirm={(reason) =>
              action.act(() => api.POST('/api/v1/admin/orders/{id}/refund', { params: { path: { id: o.id } }, body: { amountCents: cents ?? 0, reason } }))
            }
          />
        </div>
      )}
    </div>
  );
}
