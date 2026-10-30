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
import { useSave } from '@/lib/api/use-save';
import { centsToDollarsInput, dollarsToCents } from '@/lib/money';
import { instantForInput, isoToNzInput } from '@/lib/time';
import { SaveBar } from './SaveBar';
import type { Listing, StepProps } from './types';
import { DateTimeField } from './DateTimeField';

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

const toValues = (listing: Listing): { options: Row[] } => ({
  options: listing.options.length
    ? listing.options.map((o) => ({
        id: o.id,
        name: o.name,
        price: listing.pricing === 'FREE' ? '0' : centsToDollarsInput(o.priceCents),
        capacity: o.capacity === null ? '' : String(o.capacity),
        startsAt: isoToNzInput(o.startsAt),
        endsAt: isoToNzInput(o.endsAt),
        location: o.location ?? '',
        active: o.active,
      }))
    : [emptyRow],
});

// Prices are typed in dollars and become integer cents here (never float maths); the backend checks D11 ranges.
export function OptionsEditor({ listing, onSaved }: StepProps) {
  const t = useTranslations('listings.options');
  const tListings = useTranslations('listings');
  const save = useSave();
  const free = listing.pricing === 'FREE';
  const timed = listing.type !== 'RETAIL';
  const { register, control, handleSubmit, setError, reset, formState } = useForm<{ options: Row[] }>({
    resolver: zodResolver(z.object({ options: z.array(row) })),
    defaultValues: toValues(listing),
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'options' });

  const onSubmit = handleSubmit(async ({ options }) => {
    const stored = new Map(listing.options.map((o) => [o.id, o]));
    let invalid = false;
    const body = options.map((o, i) => {
      const priceCents = free ? 0 : dollarsToCents(o.price);
      if (priceCents === null) {
        setError(`options.${i}.price`, { message: t('priceInvalid') });
        invalid = true;
      }
      const original = o.id ? stored.get(o.id) : undefined;
      const times = { startsAt: o.startsAt, endsAt: o.endsAt };
      const instants = Object.fromEntries(
        (['startsAt', 'endsAt'] as const).map((key) => {
          const instant = instantForInput(original?.[key] ?? null, times[key]);
          if (times[key] && instant === null) {
            setError(`options.${i}.${key}`, { message: tListings('timeInvalid') });
            invalid = true;
          }
          return [key, instant];
        }),
      ) as { startsAt: string | null; endsAt: string | null };
      return {
        ...(o.id ? { id: o.id } : {}),
        name: o.name,
        priceCents: priceCents ?? 0,
        capacity: o.capacity ? Number(o.capacity) : null,
        ...instants,
        location: o.location || null,
        active: o.active,
      };
    });
    if (invalid) return;
    const updated = await save.run(() =>
      api.PUT('/api/v1/merchants/me/listings/{id}/options', {
        params: { path: { id: listing.id } },
        body: { revision: listing.revision, options: body },
      }),
    );
    if (updated) {
      reset(toValues(updated)); // new rows now carry their server ids
      onSaved(updated);
    }
  });

  const errorOf = (i: number, key: keyof Row) => formState.errors.options?.[i]?.[key]?.message;

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
                  aria-invalid={Boolean(errorOf(i, 'price'))}
                  {...register(`options.${i}.price`)}
                />
              )}
              {errorOf(i, 'price') && (
                <p role="alert" className="text-sm text-destructive">
                  {errorOf(i, 'price')}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`options.${i}.capacity`}>{t('capacity')}</Label>
              <Input id={`options.${i}.capacity`} inputMode="numeric" placeholder={t('unlimited')} {...register(`options.${i}.capacity`)} />
            </div>
            {timed && (
              <>
                {(['startsAt', 'endsAt'] as const).map((key) => (
                  <DateTimeField key={key} id={`options.${i}.${key}`} label={t(key)} error={errorOf(i, key)} {...register(`options.${i}.${key}`)} />
                ))}
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
