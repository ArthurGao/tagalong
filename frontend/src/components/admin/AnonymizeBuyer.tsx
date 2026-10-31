'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';
import { useSave } from '@/lib/api/use-save';
import { ConfirmWithReason } from './ConfirmWithReason';

/** A buyer's privacy deletion request (DESIGN §9): the admin types the email, then types it again to confirm. */
export function AnonymizeBuyer() {
  const t = useTranslations('admin.orders');
  const id = useId();
  const save = useSave();
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<components['schemas']['AnonymizeResultDto'] | null>(null);
  const target = email.trim();

  const anonymize = async (reason: string) => {
    const data = await save.run(() => api.POST('/api/v1/admin/buyers/anonymize', { body: { email: target, reason } }));
    if (data) {
      setDone(data);
      setEmail('');
    }
    return data !== null;
  };

  return (
    <section className="flex flex-col gap-2 rounded-[var(--radius)] border border-border bg-card p-4">
      <h2 className="font-semibold">{t('anonymize')}</h2>
      <p className="text-muted-foreground">{t('anonymizeHint')}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={id}>{t('anonymizeEmail')}</Label>
          <Input id={id} type="email" autoComplete="off" className="h-9 w-72 font-mono" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {target.includes('@') && (
          <ConfirmWithReason
            label={t('anonymize')}
            title={t('anonymizeTitle', { email: target })}
            body={t('anonymizeBody')}
            confirmText={target}
            danger
            error={save.error}
            busy={save.saving}
            onConfirm={anonymize}
          />
        )}
      </div>
      {done && <p role="status">{t('anonymizedDone', { count: done.orderCount, codes: done.publicCodes.join(', ') })}</p>}
    </section>
  );
}
