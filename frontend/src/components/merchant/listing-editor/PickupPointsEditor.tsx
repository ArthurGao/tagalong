'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api/client';
import { SaveBar } from './SaveBar';
import type { StepProps } from './types';
import { useSave } from '@/lib/api/use-save';

const row = z.object({
  id: z.string().optional(),
  label: z.string().trim().min(1).max(80),
  address: z.string().trim().min(1).max(300),
  notes: z.string().max(500),
});
type Row = z.infer<typeof row>;
const emptyRow: Row = { label: '', address: '', notes: '' };

export function PickupPointsEditor({ listing, onSaved }: StepProps) {
  const t = useTranslations('listings.pickup');
  const save = useSave();
  const { register, control, handleSubmit } = useForm<{ pickupPoints: Row[] }>({
    resolver: zodResolver(z.object({ pickupPoints: z.array(row) })),
    defaultValues: {
      pickupPoints: listing.pickupPoints.length
        ? listing.pickupPoints.map((p) => ({ id: p.id, label: p.label, address: p.address, notes: p.notes ?? '' }))
        : [emptyRow],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'pickupPoints' });

  const onSubmit = handleSubmit(async ({ pickupPoints }) => {
    const updated = await save.run(() =>
      api.PUT('/api/v1/merchants/me/listings/{id}/pickup-points', {
        params: { path: { id: listing.id } },
        body: {
          pickupPoints: pickupPoints.map((p) => ({
            ...(p.id ? { id: p.id } : {}),
            label: p.label,
            address: p.address,
            notes: p.notes || null,
          })),
        },
      }),
    );
    if (updated) onSaved(updated);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-border">
        {fields.map((field, i) => (
          <li key={field.id} className="grid gap-3 py-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`pickupPoints.${i}.label`}>{t('label')}</Label>
              <Input id={`pickupPoints.${i}.label`} {...register(`pickupPoints.${i}.label`)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`pickupPoints.${i}.address`}>{t('address')}</Label>
              <Input id={`pickupPoints.${i}.address`} {...register(`pickupPoints.${i}.address`)} />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label htmlFor={`pickupPoints.${i}.notes`}>{t('notes')}</Label>
              <Input id={`pickupPoints.${i}.notes`} {...register(`pickupPoints.${i}.notes`)} />
            </div>
            <Button type="button" variant="ghost" className="justify-self-end sm:col-span-2" onClick={() => remove(i)}>
              {t('remove')}
            </Button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" className="self-start" onClick={() => append(emptyRow)}>
        {t('add')}
      </Button>
      <SaveBar {...save} />
    </form>
  );
}
