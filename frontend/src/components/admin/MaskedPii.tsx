'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { answerValue } from '@/lib/answer-text';
import { api } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';
import { useSave } from '@/lib/api/use-save';
import { ConfirmWithReason } from './ConfirmWithReason';

type Pii = components['schemas']['AdminOrderPiiDto'];

/**
 * A buyer as the admin console shows them (DESIGN §9): masked until an admin asks, with a reason, to see them in full.
 * The full details come from POST reveal-pii (audited) and live only in this component: a reload masks them again.
 */
export function MaskedPii({ orderId, publicCode, masked }: { orderId: string; publicCode: string; masked: { name: string; email: string; phone: string } }) {
  const t = useTranslations('admin.orders');
  const save = useSave();
  const [pii, setPii] = useState<Pii | null>(null);

  const reveal = async (reason: string) => {
    const data = await save.run(() => api.POST('/api/v1/admin/orders/{id}/reveal-pii', { params: { path: { id: orderId } }, body: { reason } }));
    if (data) setPii(data);
    return data !== null;
  };

  const shown = pii ? { name: pii.buyerName, email: pii.buyerEmail, phone: pii.buyerPhone } : masked;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold">{t('pii')}</h3>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">{t('buyer')}</dt>
        <dd>{shown.name}</dd>
        <dt className="text-muted-foreground">{t('email')}</dt>
        <dd className="font-mono">{shown.email}</dd>
        <dt className="text-muted-foreground">{t('phone')}</dt>
        <dd className="font-mono">{shown.phone || '—'}</dd>
        {pii && (
          <>
            <dt className="text-muted-foreground">{t('note')}</dt>
            <dd className="whitespace-pre-wrap">{pii.buyerNote ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('answers')}</dt>
            <dd>
              <Answers answers={pii.formAnswers} />
            </dd>
            {pii.items.map((item, n) => (
              <div key={n} className="contents">
                <dt className="text-muted-foreground">
                  {t('attendee')} · {item.optionName}
                </dt>
                <dd>
                  {item.attendeeName ?? '—'}
                  {item.attendeeAnswers.map((a, i) => (
                    <Answers key={i} answers={a} />
                  ))}
                </dd>
              </div>
            ))}
          </>
        )}
      </dl>
      {!pii && (
        <div>
          <ConfirmWithReason label={t('reveal')} title={t('revealTitle', { code: publicCode })} body={t('revealBody')} error={save.error} busy={save.saving} onConfirm={reveal} />
        </div>
      )}
    </section>
  );
}

function Answers({ answers }: { answers: Record<string, unknown> }) {
  const entries = Object.entries(answers);
  if (!entries.length) return <span className="text-muted-foreground">—</span>;
  return (
    <ul>
      {entries.map(([k, v]) => (
        <li key={k}>
          <span className="text-muted-foreground">{k}:</span> {answerValue(v)}
        </li>
      ))}
    </ul>
  );
}
