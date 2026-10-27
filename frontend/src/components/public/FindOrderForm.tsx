'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api/client';
import { useSave } from '@/lib/api/use-save';
import { asLocale } from '@/lib/locale-switch';
import { Turnstile } from './Turnstile';

/**
 * Find my orders (DESIGN §9, §11): one email with links to this address's recent orders. The page says the same thing
 * whether or not the address has orders; only a failed human check is reported.
 */
export function FindOrderForm() {
  const t = useTranslations('public.findOrder');
  const locale = useLocale();
  const save = useSave();
  const [email, setEmail] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const result = await save.run(() =>
      api.POST('/api/v1/public/orders/recover', {
        body: { email: email.trim(), turnstileToken: token, locale: asLocale(locale) },
      }),
    );
    if (result) setSent(true);
    else setRun((n) => n + 1); // the used token is gone
  };

  if (sent) return <p role="status">{t('sent')}</p>;
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="email">{t('email')}</Label>
        <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <Turnstile key={run} onToken={setToken} />
      {save.error && (
        <p role="alert" className="text-sm text-destructive">
          {save.error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={save.saving || !token || !email.includes('@')}>
        {save.saving ? t('sending') : t('submit')}
      </Button>
    </form>
  );
}
