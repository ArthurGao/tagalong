'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api/client';
import { useSave } from '@/lib/api/use-save';
import { instantForInput, isoToNzInput } from '@/lib/time';
import { SaveBar } from './SaveBar';
import type { Listing, StepProps } from './types';

const row = z.object({
  id: z.string().optional(),
  label: z.string().trim().min(1).max(80),
  address: z.string().trim().min(1).max(300),
  windowStart: z.string(),
  windowEnd: z.string(),
  notes: z.string().max(500),
});
type Row = z.infer<typeof row>;
const emptyRow: Row = { label: '', address: '', windowStart: '', windowEnd: '', notes: '' };
const WINDOW = ['windowStart', 'windowEnd'] as const;

const toValues = (listing: Listing): { pickupPoints: Row[] } => ({
  pickupPoints: listing.pickupPoints.length
    ? listing.pickupPoints.map((p) => ({
        id: p.id,
        label: p.label,
        address: p.address,
        windowStart: isoToNzInput(p.windowStart),
        windowEnd: isoToNzInput(p.windowEnd),
        notes: p.notes ?? '',
      }))
    : [emptyRow],
});

export function PickupPointsEditor({ listing, onSaved }: StepProps) {
  const t = useTranslations('listings.pickup');
  const tListings = useTranslations('listings');
  const save = useSave();
  const { register, control, handleSubmit, setError, reset, formState } = useForm<{ pickupPoints: Row[] }>({
    resolver: zodResolver(z.object({ pickupPoints: z.array(row) })),
    defaultValues: toValues(listing),
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'pickupPoints' });

  const onSubmit = handleSubmit(async ({ pickupPoints }) => {
    const stored = new Map(listing.pickupPoints.map((p) => [p.id, p]));
    let invalid = false;
    const body = pickupPoints.map((p, i) => {
      const original = p.id ? stored.get(p.id) : undefined;
      const window = Object.fromEntries(
        WINDOW.map((key) => {
          const instant = instantForInput(original?.[key] ?? null, p[key]);
          if (p[key] && instant === null) {
            setError(`pickupPoints.${i}.${key}`, { message: tListings('timeInvalid') });
            invalid = true;
          }
          return [key, instant];
        }),
      ) as { windowStart: string | null; windowEnd: string | null };
      return { ...(p.id ? { id: p.id } : {}), label: p.label, address: p.address, ...window, notes: p.notes || null };
    });
    if (invalid) return;
    const updated = await save.run(() =>
      api.PUT('/api/v1/merchants/me/listings/{id}/pickup-points', {
        params: { path: { id: listing.id } },
        body: { revision: listing.revision, pickupPoints: body },
      }),
    );
    if (updated) {
      reset(toValues(updated)); // new points now carry their server ids
      onSaved(updated);
    }
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
            {WINDOW.map((key) => {
              const error = formState.errors.pickupPoints?.[i]?.[key]?.message;
              return (
                <div key={key} className="flex flex-col gap-1">
                  <Label htmlFor={`pickupPoints.${i}.${key}`}>{t(key)}</Label>
                  <Input
                    id={`pickupPoints.${i}.${key}`}
                    type="datetime-local"
                    aria-invalid={Boolean(error)}
                    {...register(`pickupPoints.${i}.${key}`)}
                  />
                  {error && (
                    <p role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  )}
                </div>
              );
            })}
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
