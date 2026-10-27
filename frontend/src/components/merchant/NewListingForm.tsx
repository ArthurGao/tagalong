'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/lib/api/client';
import { useSave } from '@/lib/api/use-save';

const schema = z.object({
  pricing: z.enum(['PAID', 'FREE']),
  type: z.enum(['RETAIL', 'SESSION', 'EVENT']),
  fulfilment: z.enum(['PICKUP', 'ONSITE']),
  title: z.string().trim().min(1).max(120),
});

// Step 1 of the editor (DESIGN §11): paid or free first; free listings skip the Stripe check.
export function NewListingForm() {
  const t = useTranslations('listings');
  const locale = useLocale();
  const router = useRouter();
  const save = useSave();
  const { register, handleSubmit } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { pricing: 'PAID', type: 'RETAIL', fulfilment: 'PICKUP', title: '' },
  });

  const onSubmit = handleSubmit(async (body) => {
    const created = await save.run(() => api.POST('/api/v1/merchants/me/listings', { body }));
    if (created) router.push(`/${locale}/dashboard/listings/${created.id}/edit`);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 rounded-[var(--radius)] border border-border bg-card p-6">
      <div className="flex flex-col gap-1">
        <Label htmlFor="pricing">{t('pricingLabel')}</Label>
        <NativeSelect id="pricing" {...register('pricing')}>
          <option value="PAID">{t('pricing.PAID')}</option>
          <option value="FREE">{t('pricing.FREE')}</option>
        </NativeSelect>
        <p className="text-sm text-muted-foreground">{t('pricingHint')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="type">{t('typeLabel')}</Label>
          <NativeSelect id="type" {...register('type')}>
            {(['RETAIL', 'SESSION', 'EVENT'] as const).map((v) => (
              <option key={v} value={v}>
                {t(`type.${v}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="fulfilment">{t('fulfilmentLabel')}</Label>
          <NativeSelect id="fulfilment" {...register('fulfilment')}>
            <option value="PICKUP">{t('fulfilment.PICKUP')}</option>
            <option value="ONSITE">{t('fulfilment.ONSITE')}</option>
          </NativeSelect>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="title">{t('fields.title')}</Label>
        <Input id="title" {...register('title')} />
      </div>
      {save.error && (
        <p role="alert" className="text-destructive">
          {save.error}
        </p>
      )}
      <Button type="submit" className="self-start" disabled={save.saving}>
        {save.saving ? t('creating') : t('create')}
      </Button>
    </form>
  );
}
