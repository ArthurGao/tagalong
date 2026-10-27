'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api/client';
import { useSave } from '@/lib/api/use-save';
import { profileSchema, type ProfileValues } from './profile-schema';

const FIELDS = ['slug', 'displayName', 'contactEmail', 'contactPhone', 'gstNumber', 'description'] as const;

export function ProfileForm({ defaultEmail }: { defaultEmail: string }) {
  const t = useTranslations('onboarding');
  const locale = useLocale();
  const router = useRouter();
  const save = useSave();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema((key) => t(`validation.${key}`))),
    defaultValues: { slug: '', displayName: '', contactEmail: defaultEmail, contactPhone: '', gstNumber: '', description: '' },
  });

  const onSubmit = handleSubmit(async ({ gstNumber, description, ...required }) => {
    const created = await save.run(() =>
      api.POST('/api/v1/merchants', {
        body: { ...required, ...(gstNumber ? { gstNumber } : {}), ...(description ? { description } : {}) },
      }),
    );
    if (created) {
      router.replace(`/${locale}/dashboard`);
      router.refresh();
    }
  });
  const slugTaken = save.code === 'SLUG_TAKEN';

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 rounded-[var(--radius)] border border-border bg-card p-6">
      {FIELDS.map((name) => (
        <div key={name} className="flex flex-col gap-1">
          <Label htmlFor={name}>{t(`fields.${name}`)}</Label>
          <Input id={name} aria-invalid={Boolean(errors[name]) || (name === 'slug' && slugTaken)} {...register(name)} />
          {name === 'slug' && <p className="text-sm text-muted-foreground">{t('fields.slugHint')}</p>}
          {(errors[name] || (name === 'slug' && slugTaken)) && (
            <p role="alert" className="text-sm text-destructive">
              {errors[name]?.message ?? save.error}
            </p>
          )}
        </div>
      ))}
      {save.error && !slugTaken && (
        <p role="alert" className="text-destructive">
          {save.error}
        </p>
      )}
      <Button type="submit" disabled={isSubmitting || save.saving} className="self-start">
        {isSubmitting || save.saving ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
