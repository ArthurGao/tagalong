'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';
import { errorMessageKey } from '@/lib/api/errors';
import type { components } from '@/lib/api/schema';

// Mirrors the backend presign DTO; `satisfies` makes a backend type change a compile error here.
const TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const satisfies readonly components['schemas']['PresignUploadDto']['contentType'][];
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 9;

// Presigned PUT straight to S3/R2; the signed Content-Length is what enforces the 5 MB limit.
export function ImageUploader({ images, onChange }: { images: string[]; onChange: (images: string[]) => void }) {
  const t = useTranslations('listings.images');
  const tErrors = useTranslations('errors');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    const contentType = TYPES.find((type) => type === file.type);
    if (!contentType || file.size > MAX_BYTES) {
      setError(t('tooBig'));
      return;
    }
    setBusy(true);
    try {
      const { data, error: apiError } = await api.POST('/api/v1/uploads/presign', {
        body: { contentType, contentLength: file.size },
      });
      if (!data) {
        // BAD_REQUEST is what the backend returns while storage is not configured.
        setError(apiError?.code === 'BAD_REQUEST' ? t('notConfigured') : tErrors(errorMessageKey(apiError?.code)));
        return;
      }
      const put = await fetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
      if (!put.ok) throw new Error(`upload ${put.status}`);
      onChange([...images, data.publicUrl]);
    } catch {
      setError(t('failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-2">
        {images.map((url) => (
          <li key={url} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- merchant uploads on our storage domain */}
            <img src={url} alt="" className="size-24 rounded-[var(--radius)] object-cover" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-0 top-0 bg-card/80"
              onClick={() => onChange(images.filter((u) => u !== url))}
            >
              {t('remove')}
            </Button>
          </li>
        ))}
      </ul>
      {images.length < MAX_IMAGES && (
        <label className="inline-flex min-h-11 cursor-pointer items-center self-start rounded-[var(--radius)] border border-border px-4">
          {busy ? t('uploading') : t('add')}
          <input
            type="file"
            accept={TYPES.join(',')}
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void upload(file);
            }}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
