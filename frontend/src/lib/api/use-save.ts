'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { type ErrorCode, errorMessageKey } from './errors';

type ApiResult<T> = { data?: T; error?: { code?: string; details?: unknown } | string };

// Runs an API write from the browser (so it carries our Origin, see backend OriginGuard) and maps failures,
// including network errors, to i18n messages. Every client component that writes uses this.
export function useSave() {
  const tErrors = useTranslations('errors');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<ErrorCode | null>(null);
  const [details, setDetails] = useState<string[]>([]);

  async function run<T>(call: () => Promise<ApiResult<T>>): Promise<T | null> {
    setSaving(true);
    setSaved(false);
    setError(null);
    setCode(null);
    setDetails([]);
    try {
      const { data, error: apiError } = await call();
      if (data) {
        setSaved(true);
        return data;
      }
      // A non-JSON error body (e.g. a proxy's 502 page) arrives as a string and maps to INTERNAL.
      const body = typeof apiError === 'object' ? apiError : undefined;
      const errorCode = errorMessageKey(body?.code);
      setCode(errorCode);
      setError(tErrors(errorCode));
      if (Array.isArray(body?.details)) setDetails(body.details.map(String));
      return null;
    } catch {
      setCode('INTERNAL');
      setError(tErrors('INTERNAL')); // network failure: no response body to map
      return null;
    } finally {
      setSaving(false);
    }
  }

  return { run, saving, saved, error, code, details };
}
