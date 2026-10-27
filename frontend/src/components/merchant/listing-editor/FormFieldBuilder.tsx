'use client';

import { useTranslations } from 'next-intl';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import type { FormFieldInput } from './types';

export const MAX_FORM_FIELDS = 10; // backend MAX_FORM_FIELDS / @ArrayMaxSize
export const FORM_FIELD_TYPES = ['text', 'textarea', 'number', 'select', 'multiselect', 'checkbox'] as const satisfies readonly FormFieldInput['type'][];

/** A sign-up question as edited: choices are typed comma separated. */
export type FormFieldRow = Omit<FormFieldInput, 'options'> & { options: string };

export interface FormFieldsShape {
  formFields: FormFieldRow[];
}

// DESIGN §10: merchants should only ask what the event needs; the backend flags sensitive labels.
// Must render inside a <FormProvider> whose form has a `formFields` array.
export function FormFieldBuilder({ sensitiveKeys }: { sensitiveKeys: string[] }) {
  const t = useTranslations('listings.formFields');
  const { control, register } = useFormContext<FormFieldsShape>();
  const { fields, append, remove } = useFieldArray({ control, name: 'formFields' });
  const values = useWatch({ control, name: 'formFields' });
  const sensitiveLabels = (values ?? []).filter((f) => sensitiveKeys.includes(f.key)).map((f) => f.label);

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="font-bold">{t('title')}</legend>
      <p className="text-sm text-muted-foreground">{t('hint')}</p>
      {sensitiveLabels.length > 0 && (
        <p role="alert" className="text-sm text-warning">
          {t('sensitive', { labels: sensitiveLabels.join(', ') })}
        </p>
      )}
      <ul className="flex flex-col divide-y divide-border">
        {fields.map((field, i) => {
          const type = values?.[i]?.type;
          return (
            <li key={field.id} className="grid gap-3 py-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor={`formFields.${i}.label`}>{t('label')}</Label>
                <Input id={`formFields.${i}.label`} {...register(`formFields.${i}.label`)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`formFields.${i}.key`}>{t('key')}</Label>
                <Input id={`formFields.${i}.key`} {...register(`formFields.${i}.key`)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`formFields.${i}.type`}>{t('type')}</Label>
                <NativeSelect id={`formFields.${i}.type`} {...register(`formFields.${i}.type`)}>
                  {FORM_FIELD_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {t(`types.${v}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`formFields.${i}.scope`}>{t('scope')}</Label>
                <NativeSelect id={`formFields.${i}.scope`} {...register(`formFields.${i}.scope`)}>
                  <option value="order">{t('scopeOrder')}</option>
                  <option value="attendee">{t('scopeAttendee')}</option>
                </NativeSelect>
              </div>
              {(type === 'select' || type === 'multiselect') && (
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <Label htmlFor={`formFields.${i}.options`}>{t('options')}</Label>
                  <Input id={`formFields.${i}.options`} {...register(`formFields.${i}.options`)} />
                </div>
              )}
              <div className="flex items-center justify-between sm:col-span-2">
                <CheckboxField label={t('required')} {...register(`formFields.${i}.required`)} />
                <Button type="button" variant="ghost" onClick={() => remove(i)}>
                  {t('remove')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={fields.length >= MAX_FORM_FIELDS}
          onClick={() =>
            append({ key: `q${fields.length + 1}`, label: '', type: 'text', required: false, scope: 'order', options: '' })
          }
        >
          {t('add')}
        </Button>
        <span className="text-sm text-muted-foreground">{t('max')}</span>
      </div>
    </fieldset>
  );
}
