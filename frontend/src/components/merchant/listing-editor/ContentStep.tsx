'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api/client';
import { instantForInput, isoToNzInput } from '@/lib/time';
import { ImageUploader } from './ImageUploader';
import { SaveBar } from './SaveBar';
import type { StepProps } from './types';
import { useSave } from '@/lib/api/use-save';
import { DateTimeField } from './DateTimeField';

const schema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(10_000),
  closesAt: z.string(),
  images: z.array(z.string()),
});

export function ContentStep({ listing, onSaved }: StepProps) {
  const t = useTranslations('listings.fields');
  const tListings = useTranslations('listings');
  const save = useSave();
  const { register, control, handleSubmit, setError, reset, formState } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: listing.title,
      description: listing.description,
      closesAt: isoToNzInput(listing.closesAt),
      images: listing.images,
    },
  });

  const onSubmit = handleSubmit(async (v) => {
    const closesAt = instantForInput(listing.closesAt, v.closesAt);
    if (v.closesAt && closesAt === null) {
      setError('closesAt', { message: tListings('timeInvalid') });
      return;
    }
    const updated = await save.run(() =>
      api.PATCH('/api/v1/merchants/me/listings/{id}', {
        params: { path: { id: listing.id } },
        body: { revision: listing.revision, title: v.title, description: v.description, images: v.images, closesAt },
      }),
    );
    if (updated) {
      reset({ ...v, closesAt: isoToNzInput(updated.closesAt) });
      onSaved(updated);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="title">{t('title')}</Label>
        <Input id="title" {...register('title')} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="description">{t('description')}</Label>
        <Textarea id="description" rows={6} {...register('description')} />
      </div>
      <DateTimeField id="closesAt" label={t('closesAt')} error={formState.errors.closesAt?.message} {...register('closesAt')} />
      <div className="flex flex-col gap-1">
        <span className="text-sm font-bold">{t('images')}</span>
        <Controller
          control={control}
          name="images"
          render={({ field }) => <ImageUploader images={field.value} onChange={field.onChange} />}
        />
      </div>
      <SaveBar {...save} />
    </form>
  );
}
