'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { api } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';
import { listingStatusKey } from '@/lib/listing-status';
import { formatCents } from '@/lib/money';
import { formatNzDateTime } from '@/lib/time';
import { ConfirmWithReason } from './ConfirmWithReason';
import { useAdminAction } from './use-admin-action';

type Listing = components['schemas']['AdminListingDto'];

/** The listing drawer: options, orders, the cancellation, and close / take down / restore (DESIGN §9). */
export function ListingDetail({ listing: l }: { listing: Listing }) {
  const t = useTranslations('admin.listings');
  const tStatus = useTranslations('admin.listingStatus');
  const tPricing = useTranslations('listings.pricing');
  const tOrder = useTranslations('orders.status');
  const locale = useLocale();
  const action = useAdminAction();
  const [refundAll, setRefundAll] = useState(false);
  const path = { params: { path: { id: l.id } } };

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-1">
        <p>
          <span className="font-mono">{l.shortCode}</span> · {tStatus(listingStatusKey(l))} · {tPricing(l.pricing)}
        </p>
        <p>
          <Link className="text-primary underline" href={`/${locale}/merchants?id=${l.merchant.id}`}>
            {l.merchant.displayName}
          </Link>{' '}
          <span className="font-mono text-muted-foreground">{l.merchant.slug}</span>
        </p>
        {l.takenDownReason && (
          <p className="text-destructive">{t('takenDownBecause', { when: l.takenDownAt ? formatNzDateTime(l.takenDownAt, locale) : '', reason: l.takenDownReason })}</p>
        )}
        {l.closesAt && (
          <p className="text-muted-foreground">
            {t('closes')} {formatNzDateTime(l.closesAt, locale)}
          </p>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        {l.canClose && (
          <ConfirmWithReason
            label={t('close')}
            title={t('closeTitle', { title: l.title })}
            body={t('closeBody')}
            error={action.error}
            busy={action.busy}
            onConfirm={(reason) => action.act(() => api.POST('/api/v1/admin/listings/{id}/close', { ...path, body: { reason } }))}
          />
        )}
        {l.canTakedown && (
          <ConfirmWithReason
            label={t('takedown')}
            title={t('takedownTitle', { title: l.title })}
            body={t('takedownBody')}
            confirmText={l.merchant.slug}
            danger
            error={action.error}
            busy={action.busy}
            extra={
              <CheckboxField
                label={l.pricing === 'FREE' ? t('refundAllFree') : t('refundAllPaid')}
                checked={refundAll}
                onChange={(e) => setRefundAll(e.target.checked)}
              />
            }
            onConfirm={(reason) => action.act(() => api.POST('/api/v1/admin/listings/{id}/takedown', { ...path, body: { reason, refundAll } }))}
          />
        )}
        {l.canRestore && (
          <ConfirmWithReason
            label={t('restore')}
            title={t('restoreTitle', { title: l.title })}
            body={t('restoreBody')}
            error={action.error}
            busy={action.busy}
            onConfirm={(reason) => action.act(() => api.POST('/api/v1/admin/listings/{id}/restore', { ...path, body: { reason } }))}
          />
        )}
      </div>

      {l.cancellation && (
        <section>
          <h3 className="mb-1 font-semibold">{t('cancellation')}</h3>
          <p>
            {t(`cancellationStatus.${l.cancellation.status}`)} ·{' '}
            {t('progress', {
              total: l.cancellation.totalOrders,
              succeeded: l.cancellation.succeeded,
              failed: l.cancellation.failed,
              pending: l.cancellation.pending,
            })}
          </p>
          <p className="text-muted-foreground">{l.cancellation.reason}</p>
        </section>
      )}

      <section>
        <h3 className="mb-1 font-semibold">{t('options')}</h3>
        <table className="w-full text-left">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">{t('option')}</th>
              <th className="py-1 font-normal">{t('price')}</th>
              <th className="py-1 font-normal">{t('sold')}</th>
              <th className="py-1 font-normal">{t('capacity')}</th>
            </tr>
          </thead>
          <tbody>
            {l.options.map((o, i) => (
              <tr key={i} className="border-t border-border">
                <td className="py-1">
                  {o.name}
                  {!o.active && <span className="text-muted-foreground"> · {t('inactive')}</span>}
                </td>
                <td className="py-1 font-mono">{formatCents(o.priceCents)}</td>
                <td className="py-1 font-mono">
                  {o.soldCount}
                  {o.reservedCount > 0 && ` +${o.reservedCount}`}
                </td>
                <td className="py-1 font-mono">{o.capacity ?? t('unlimited')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3 className="mb-1 font-semibold">{t('orders')}</h3>
        {l.orderCounts.length ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {l.orderCounts.map((c) => (
              <li key={c.status}>
                <span className="text-muted-foreground">{tOrder(c.status)}</span> <span className="font-mono">{c.count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">{t('noOrders')}</p>
        )}
      </section>
    </div>
  );
}
