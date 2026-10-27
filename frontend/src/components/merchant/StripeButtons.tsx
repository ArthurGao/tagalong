'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';
import { errorMessageKey } from '@/lib/api/errors';

// Runs in the browser so the POST carries our Origin (backend OriginGuard); then hands over to Stripe.
export function StripeOnboardButton({ label }: { label: 'start' | 'continue' }) {
  const t = useTranslations('stripe');
  const tErrors = useTranslations('errors');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onboard = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data, error: apiError } = await api.POST('/api/v1/merchants/me/stripe/onboard');
      if (data) {
        window.location.href = data.url;
        return; // stay busy while the browser leaves for Stripe
      }
      setError(tErrors(errorMessageKey(apiError?.code)));
    } catch {
      setError(tErrors('INTERNAL')); // network failure: no response body to map
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={onboard} disabled={busy}>
        {busy ? t('starting') : t(label)}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
