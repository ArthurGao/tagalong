'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';
import { useSave } from '@/lib/api/use-save';
import { listingStatusKey } from '@/lib/listing-status';
import { formatCents } from '@/lib/money';
import { formatNzDateTime } from '@/lib/time';
import { ConfirmWithReason } from './ConfirmWithReason';
import { RiskFlags } from './RiskFlags';
import { useAdminAction } from './use-admin-action';

type Merchant = components['schemas']['AdminMerchantDto'];

/** The merchant drawer: profile, Stripe, risk figures, listings, notes, and suspend / reinstate. */
export function MerchantDetail({ merchant: m }: { merchant: Merchant }) {
  const t = useTranslations('admin.merchants');
  const tStatus = useTranslations('admin.merchantStatus');
  const tListing = useTranslations('admin.listingStatus');
  const locale = useLocale();
  const router = useRouter();
  const action = useAdminAction();
  const noteSave = useSave();
  const noteId = useId();
  const [note, setNote] = useState('');
  const path = { params: { path: { id: m.id } } };
  const yesNo = (v: boolean) => (v ? t('yes') : t('no'));

  const addNote = async () => {
    if (await noteSave.run(() => api.POST('/api/v1/admin/merchants/{id}/notes', { ...path, body: { note: note.trim() } }))) {
      setNote('');
      router.refresh();
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-1">
        <p className="font-mono text-muted-foreground">{m.slug}</p>
        <p>
          {tStatus(m.status)} · {formatNzDateTime(m.createdAt, locale)}
        </p>
        <RiskFlags flags={m.riskFlags} />
        {m.suspendedReason && (
          <p className="text-destructive">{t('suspendedBecause', { when: m.suspendedAt ? formatNzDateTime(m.suspendedAt, locale) : '', reason: m.suspendedReason })}</p>
        )}
        {m.ownerDeleted && <p className="text-destructive">{t('ownerDeleted')}</p>}
      </section>

      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">{t('contact')}</dt>
        <dd>
          {m.contactEmail} · {m.contactPhone}
        </dd>
        <dt className="text-muted-foreground">{t('gst')}</dt>
        <dd className="font-mono">{m.gstNumber ?? '—'}</dd>
        <dt className="text-muted-foreground">{t('stripe')}</dt>
        <dd className="font-mono">{m.stripeAccountId ?? '—'}</dd>
        <dt className="text-muted-foreground">{t('charges')}</dt>
        <dd>
          {yesNo(m.chargesEnabled)} · {t('payouts')} {yesNo(m.payoutsEnabled)}
        </dd>
        <dt className="text-muted-foreground">{t('orders')}</dt>
        <dd className="font-mono">{m.orderCount}</dd>
        <dt className="text-muted-foreground">{t('disputes')}</dt>
        <dd className="font-mono">
          {m.disputeCount} ({m.figures.openDisputes})
        </dd>
      </dl>

      <section>
        <h3 className="mb-1 font-semibold">{t('figures')}</h3>
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 font-mono">
          <dt className="font-sans text-muted-foreground">{t('paid90')}</dt>
          <dd>{formatCents(m.figures.paidCents90d)}</dd>
          <dt className="font-sans text-muted-foreground">{t('refunded90')}</dt>
          <dd>{formatCents(m.figures.refundedCents90d)}</dd>
          <dt className="font-sans text-muted-foreground">{t('today')}</dt>
          <dd>{formatCents(m.figures.todayCents)}</dd>
          <dt className="font-sans text-muted-foreground">{t('previous30')}</dt>
          <dd>{formatCents(m.figures.previous30dCents)}</dd>
        </dl>
      </section>

      <div className="flex flex-wrap gap-2">
        {m.status === 'ACTIVE' ? (
          <ConfirmWithReason
            label={t('suspend')}
            title={t('suspendTitle', { name: m.displayName })}
            body={t('suspendBody')}
            confirmText={m.slug}
            danger
            error={action.error}
            busy={action.busy}
            onConfirm={(reason) => action.act(() => api.POST('/api/v1/admin/merchants/{id}/suspend', { ...path, body: { reason } }))}
          />
        ) : (
          !m.ownerDeleted && (
            <ConfirmWithReason
              label={t('reinstate')}
              title={t('reinstateTitle', { name: m.displayName })}
              body={t('reinstateBody')}
              error={action.error}
              busy={action.busy}
              onConfirm={(reason) => action.act(() => api.POST('/api/v1/admin/merchants/{id}/reinstate', { ...path, body: { reason } }))}
            />
          )
        )}
      </div>

      <section>
        <h3 className="mb-1 font-semibold">{t('listings')}</h3>
        <ul className="flex flex-col gap-1">
          {m.listings.map((l) => (
            <li key={l.id}>
              <Link className="text-primary underline" href={`/${locale}/listings?id=${l.id}`}>
                {l.title}
              </Link>{' '}
              <span className="text-muted-foreground">· {tListing(listingStatusKey(l))}</span>
            </li>
          ))}
        </ul>
        <Link className="mt-1 inline-block text-primary underline" href={`/${locale}/listings?merchantId=${m.id}`}>
          {t('allListings')}
        </Link>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">{t('notes')}</h3>
        {m.notes.length ? (
          <ul className="flex flex-col gap-2">
            {m.notes.map((n) => (
              <li key={n.id} className="rounded-[var(--radius)] border border-border p-2">
                <p className="whitespace-pre-wrap">{n.note}</p>
                <p className="text-xs text-muted-foreground">
                  {n.authorEmail} · {formatNzDateTime(n.createdAt, locale)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">{t('noNotes')}</p>
        )}
        <Label htmlFor={noteId} className="sr-only">
          {t('addNote')}
        </Label>
        <Textarea id={noteId} rows={2} maxLength={2000} placeholder={t('notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} />
        {noteSave.error && (
          <p role="alert" className="text-sm text-destructive">
            {noteSave.error}
          </p>
        )}
        <Button type="button" size="sm" variant="outline" className="self-start" disabled={!note.trim() || noteSave.saving} onClick={addNote}>
          {t('addNote')}
        </Button>
      </section>
    </div>
  );
}
