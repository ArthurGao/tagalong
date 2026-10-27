'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';
import { useSave } from '@/lib/api/use-save';

// Hands over to Stripe; stays busy while the browser leaves the page.
export function StripeOnboardButton({ label }: { label: 'start' | 'continue' }) {
  const t = useTranslations('stripe');
  const save = useSave();

  const onboard = async () => {
    const link = await save.run(() => api.POST('/api/v1/merchants/me/stripe/onboard'));
    if (link) window.location.href = link.url;
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={onboard} disabled={save.saving || save.saved}>
        {save.saving || save.saved ? t('starting') : t(label)}
      </Button>
      {save.error && (
        <p role="alert" className="text-sm text-destructive">
          {save.error}
        </p>
      )}
    </div>
  );
}
