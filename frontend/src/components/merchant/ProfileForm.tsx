'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api/client';
import { errorMessageKey } from '@/lib/api/errors';
import { profileSchema, type ProfileValues } from './profile-schema';

const FIELDS = ['slug', 'displayName', 'contactEmail', 'contactPhone', 'gstNumber', 'description'] as const;

export function ProfileForm({ defaultEmail }: { defaultEmail: string }) {
  const t = useTranslations('onboarding');
  const tErrors = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema((key) => t(`validation.${key}`))),
    defaultValues: { slug: '', displayName: '', contactEmail: defaultEmail, contactPhone: '', gstNumber: '', description: '' },
  });

  const onSubmit = handleSubmit(async ({ gstNumber, description, ...required }) => {
    setFormError(null);
    const { error } = await api.POST('/api/v1/merchants', {
      body: { ...required, ...(gstNumber ? { gstNumber } : {}), ...(description ? { description } : {}) },
    });
    if (!error) {
      router.replace(`/${locale}/dashboard`);
      router.refresh();
      return;
    }
    const code = errorMessageKey(error.code);
    if (code === 'SLUG_TAKEN') setError('slug', { message: tErrors(code) });
    else setFormError(tErrors(code));
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 rounded-[var(--radius)] border border-border bg-card p-6">
      {FIELDS.map((name) => (
        <div key={name} className="flex flex-col gap-1">
          <Label htmlFor={name}>{t(`fields.${name}`)}</Label>
          <Input id={name} aria-invalid={Boolean(errors[name])} {...register(name)} />
          {name === 'slug' && <p className="text-sm text-muted-foreground">{t('fields.slugHint')}</p>}
          {errors[name] && (
            <p role="alert" className="text-sm text-destructive">
              {errors[name]?.message}
            </p>
          )}
        </div>
      ))}
      {formError && (
        <p role="alert" className="text-destructive">
          {formError}
        </p>
      )}
      <Button type="submit" disabled={isSubmitting} className="self-start">
        {isSubmitting ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
