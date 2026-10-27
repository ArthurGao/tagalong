'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api/client';
import { centsToDollarsInput, dollarsToCents } from '@/lib/money';
import { isoToNzInput, nzInputToIso } from '@/lib/time';
import { SaveBar } from './SaveBar';
import type { StepProps } from './types';
import { useSave } from '@/lib/api/use-save';

const row = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(80),
  price: z.string(),
  capacity: z.string().regex(/^(\d*)$/),
  startsAt: z.string(),
  endsAt: z.string(),
  location: z.string().max(200),
  active: z.boolean(),
});
type Row = z.infer<typeof row>;

const emptyRow: Row = { name: '', price: '', capacity: '', startsAt: '', endsAt: '', location: '', active: true };

// Prices are typed in dollars and become integer cents here (never float maths); the backend checks D11 ranges.
export function OptionsEditor({ listing, onSaved }: StepProps) {
  const t = useTranslations('listings.options');
  const save = useSave();
  const free = listing.pricing === 'FREE';
  const timed = listing.type !== 'RETAIL';
  const { register, control, handleSubmit, setError, formState } = useForm<{ options: Row[] }>({
    resolver: zodResolver(z.object({ options: z.array(row) })),
    defaultValues: {
      options: listing.options.length
        ? listing.options.map((o) => ({
            id: o.id,
            name: o.name,
            price: free ? '0' : centsToDollarsInput(o.priceCents),
            capacity: o.capacity === null ? '' : String(o.capacity),
            startsAt: isoToNzInput(o.startsAt),
            endsAt: isoToNzInput(o.endsAt),
            location: o.location ?? '',
            active: o.active,
          }))
        : [emptyRow],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'options' });

  const onSubmit = handleSubmit(async ({ options }) => {
    const priced = options.map((o) => ({ ...o, priceCents: free ? 0 : dollarsToCents(o.price) }));
    const invalid = priced.findIndex((o) => o.priceCents === null);
    if (invalid !== -1) {
      setError(`options.${invalid}.price`, { message: t('priceInvalid') });
      return;
    }
    const updated = await save.run(() =>
      api.PUT('/api/v1/merchants/me/listings/{id}/options', {
        params: { path: { id: listing.id } },
        body: {
          options: priced.map((o) => ({
            ...(o.id ? { id: o.id } : {}),
            name: o.name,
            priceCents: o.priceCents as number,
            capacity: o.capacity ? Number(o.capacity) : null,
            startsAt: nzInputToIso(o.startsAt),
            endsAt: nzInputToIso(o.endsAt),
            location: o.location || null,
            active: o.active,
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
              <Label htmlFor={`options.${i}.name`}>{t('name')}</Label>
              <Input id={`options.${i}.name`} {...register(`options.${i}.name`)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`options.${i}.price`}>{t('price')}</Label>
              {free ? (
                <p className="flex h-11 items-center">{t('free')}</p>
              ) : (
                <Input
                  id={`options.${i}.price`}
                  inputMode="decimal"
                  aria-invalid={Boolean(formState.errors.options?.[i]?.price)}
                  {...register(`options.${i}.price`)}
                />
              )}
              {formState.errors.options?.[i]?.price && (
                <p role="alert" className="text-sm text-destructive">
                  {formState.errors.options[i]?.price?.message}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`options.${i}.capacity`}>{t('capacity')}</Label>
              <Input id={`options.${i}.capacity`} inputMode="numeric" placeholder={t('unlimited')} {...register(`options.${i}.capacity`)} />
            </div>
            {timed && (
              <>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`options.${i}.startsAt`}>{t('startsAt')}</Label>
                  <Input id={`options.${i}.startsAt`} type="datetime-local" {...register(`options.${i}.startsAt`)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`options.${i}.endsAt`}>{t('endsAt')}</Label>
                  <Input id={`options.${i}.endsAt`} type="datetime-local" {...register(`options.${i}.endsAt`)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`options.${i}.location`}>{t('location')}</Label>
                  <Input id={`options.${i}.location`} {...register(`options.${i}.location`)} />
                </div>
              </>
            )}
            <div className="flex items-center justify-between gap-3 sm:col-span-2">
              <CheckboxField label={t('active')} {...register(`options.${i}.active`)} />
              <Button type="button" variant="ghost" onClick={() => remove(i)}>
                {t('remove')}
              </Button>
            </div>
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
