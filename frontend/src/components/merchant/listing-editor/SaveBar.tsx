'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export function SaveBar({ saving, saved, error }: { saving: boolean; saved: boolean; error: string | null }) {
  const t = useTranslations('listings');
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" disabled={saving}>
        {saving ? t('saving') : t('save')}
      </Button>
      {saved && !error && <span className="text-sm text-muted-foreground">{t('saved')}</span>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
