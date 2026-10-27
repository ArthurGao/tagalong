'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api/client';
import { FORM_FIELD_TYPES, FormFieldBuilder, type FormFieldRow } from './FormFieldBuilder';
import { SaveBar } from './SaveBar';
import type { StepProps } from './types';
import { useSave } from '@/lib/api/use-save';

const int = z.string().trim().regex(/^\d+$/);
const optionalInt = z.string().trim().regex(/^\d*$/);
const schema = z.object({
  policyText: z.string().max(5_000),
  maxQtyPerOrder: int,
  totalCapacity: optionalInt,
  remindBeforeHours: optionalInt,
  onePerEmail: z.boolean(),
  allowSelfCancel: z.boolean(),
  indexable: z.boolean(),
  showParticipants: z.boolean(),
  formFields: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      type: z.enum(FORM_FIELD_TYPES),
      required: z.boolean(),
      scope: z.enum(['order', 'attendee']),
      options: z.string(),
    }),
  ),
});
type SettingsValues = z.infer<typeof schema>;

const toIntOrNull = (v: string) => (v.trim() ? Number(v) : null);

export function SettingsStep({ listing, onSaved }: StepProps) {
  const t = useTranslations('listings.fields');
  const save = useSave();
  const form = useForm<SettingsValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      policyText: listing.policyText,
      maxQtyPerOrder: String(listing.maxQtyPerOrder),
      totalCapacity: listing.totalCapacity === null ? '' : String(listing.totalCapacity),
      remindBeforeHours: listing.remindBeforeHours === null ? '' : String(listing.remindBeforeHours),
      onePerEmail: listing.onePerEmail,
      allowSelfCancel: listing.allowSelfCancel,
      indexable: listing.indexable,
      showParticipants: listing.showParticipants,
      formFields: listing.formFields.map((f): FormFieldRow => ({ ...f, options: (f.options ?? []).join(', ') })),
    },
  });
  const { register, handleSubmit } = form;

  const onSubmit = handleSubmit(async (v) => {
    const updated = await save.run(() =>
      api.PATCH('/api/v1/merchants/me/listings/{id}', {
        params: { path: { id: listing.id } },
        body: {
          policyText: v.policyText,
          maxQtyPerOrder: Number(v.maxQtyPerOrder),
          totalCapacity: toIntOrNull(v.totalCapacity),
          remindBeforeHours: listing.type === 'RETAIL' ? null : toIntOrNull(v.remindBeforeHours),
          onePerEmail: v.onePerEmail,
          allowSelfCancel: v.allowSelfCancel,
          indexable: v.indexable,
          showParticipants: v.showParticipants,
          formFields: v.formFields.map(({ options, ...f }) => {
            const choices = options.split(',').map((o) => o.trim()).filter(Boolean);
            return choices.length ? { ...f, options: choices } : f;
          }),
        },
      }),
    );
    if (updated) onSaved(updated);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="policyText">{t('policyText')}</Label>
        <Textarea id="policyText" {...register('policyText')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="maxQtyPerOrder">{t('maxQtyPerOrder')}</Label>
          <Input id="maxQtyPerOrder" inputMode="numeric" {...register('maxQtyPerOrder')} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="totalCapacity">{t('totalCapacity')}</Label>
          <Input id="totalCapacity" inputMode="numeric" {...register('totalCapacity')} />
        </div>
        {listing.type !== 'RETAIL' && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="remindBeforeHours">{t('remindBeforeHours')}</Label>
            <Input id="remindBeforeHours" inputMode="numeric" {...register('remindBeforeHours')} />
          </div>
        )}
      </div>
      <div className="flex flex-col">
        <CheckboxField label={t('onePerEmail')} {...register('onePerEmail')} />
        <CheckboxField label={t('allowSelfCancel')} {...register('allowSelfCancel')} />
        <CheckboxField label={t('showParticipants')} {...register('showParticipants')} />
        <CheckboxField label={t('indexable')} {...register('indexable')} />
      </div>
      <FormProvider {...form}>
        <FormFieldBuilder sensitiveKeys={listing.formFieldWarnings} />
      </FormProvider>
      <SaveBar {...save} />
    </form>
  );
}
