'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import type { AnswerProblem, Answers, FormField } from './answers';

/** The merchant's custom sign-up fields (DESIGN §9), rendered by type. Labels are the merchant's own text. */
export function DynamicFields({
  fields,
  values,
  problems,
  idPrefix,
  onChange,
}: {
  fields: FormField[];
  values: Answers;
  problems: Record<string, AnswerProblem>;
  idPrefix: string;
  onChange: (key: string, value: unknown) => void;
}) {
  const t = useTranslations('public.checkout');
  return (
    <>
      {fields.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        const value = values[f.key];
        const text = typeof value === 'string' ? value : '';
        const options = f.options ?? [];
        const label = f.required ? t('requiredLabel', { label: f.label }) : f.label;
        const set = (v: unknown) => onChange(f.key, v);

        // Checkbox and multiselect label themselves; everything else gets a <Label> above the control.
        let control: ReactNode;
        let labelled = true;
        switch (f.type) {
          case 'checkbox':
            control = <CheckboxField id={id} label={label} checked={value === true} onChange={(e) => set(e.target.checked)} />;
            labelled = false;
            break;
          case 'multiselect': {
            const chosen = Array.isArray(value) ? (value as string[]) : [];
            control = (
              <fieldset className="flex flex-col gap-1">
                <legend className="text-sm font-medium">{label}</legend>
                {options.map((o) => (
                  <CheckboxField
                    key={o}
                    label={o}
                    checked={chosen.includes(o)}
                    onChange={(e) => set(e.target.checked ? [...chosen, o] : chosen.filter((c) => c !== o))}
                  />
                ))}
              </fieldset>
            );
            labelled = false;
            break;
          }
          case 'select':
            control = (
              <NativeSelect id={id} value={text} onChange={(e) => set(e.target.value)}>
                <option value="">{t('choose')}</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </NativeSelect>
            );
            break;
          case 'textarea':
            control = <Textarea id={id} rows={2} value={text} onChange={(e) => set(e.target.value)} />;
            break;
          case 'number':
            control = (
              <Input
                id={id}
                type="number"
                inputMode="decimal"
                value={typeof value === 'number' ? String(value) : ''}
                onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))}
              />
            );
            break;
          default:
            control = <Input id={id} type="text" value={text} onChange={(e) => set(e.target.value)} />;
        }

        return (
          <div key={f.key} className="flex flex-col gap-1">
            {labelled && <Label htmlFor={id}>{label}</Label>}
            {control}
            {problems[f.key] && <p className="text-sm text-destructive">{t(`answer.${problems[f.key]}`)}</p>}
          </div>
        );
      })}
    </>
  );
}
