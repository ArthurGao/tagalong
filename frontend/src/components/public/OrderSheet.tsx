'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api/client';
import { useSave } from '@/lib/api/use-save';
import { formatCents } from '@/lib/money';
import { goTo } from '@/lib/navigate';
import { routing } from '@/i18n/routing';
import { liveListingKey, useLiveListing } from './live-listing';
import { buyerSchema, type BuyerValues, maxFor } from './order-schema';

const FIELDS = [
  { name: 'name', type: 'text', autoComplete: 'name' },
  { name: 'email', type: 'email', autoComplete: 'email' },
  { name: 'phone', type: 'tel', autoComplete: 'tel' },
] as const;

// The buyer form (DESIGN §11). Prices shown here are display only; the backend computes every amount.
export function OrderSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('public.checkout');
  const locale = useLocale();
  const l = useLiveListing();
  const queryClient = useQueryClient();
  const save = useSave();
  // One key per opened form, reused on every retry and replaced only after a success (DESIGN §7.2).
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    l.options.length === 1 ? { [l.options[0].id]: 1 } : {},
  );
  const [pickupPointId, setPickupPointId] = useState(() => (l.pickupPoints.length === 1 ? l.pickupPoints[0].id : ''));
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BuyerValues>({
    resolver: zodResolver(buyerSchema((key) => t(`validation.${key}`))),
    defaultValues: { name: '', email: '', phone: '', note: '', anonymous: false },
  });

  const chosen = Object.values(quantities).reduce((sum, q) => sum + q, 0);
  const subtotal = l.options.reduce((sum, o) => sum + o.priceCents * (quantities[o.id] ?? 0), 0);
  const needsPickup = l.pickupPoints.length > 0;

  const setQuantity = (id: string, q: number) => {
    setFormError(null);
    setQuantities((prev) => ({ ...prev, [id]: q }));
  };

  const onSubmit = handleSubmit(async (buyer) => {
    const items = Object.entries(quantities)
      .filter(([, q]) => q > 0)
      .map(([optionId, quantity]) => ({ optionId, quantity }));
    if (!items.length) return setFormError(t('validation.items'));
    if (needsPickup && !pickupPointId) return setFormError(t('validation.pickup'));
    const result = await save.run(() =>
      api.POST('/api/v1/public/listings/{shortCode}/orders', {
        params: { path: { shortCode: l.shortCode }, header: { 'Idempotency-Key': idempotencyKey } },
        body: {
          items,
          buyer: { name: buyer.name, email: buyer.email, phone: buyer.phone },
          ...(needsPickup ? { pickupPointId } : {}),
          ...(buyer.note.trim() ? { note: buyer.note.trim() } : {}),
          anonymous: buyer.anonymous,
          locale: routing.locales.find((l) => l === locale) ?? routing.defaultLocale,
        },
      }),
    );
    if (result?.checkoutUrl) return goTo(result.checkoutUrl);
  });

  // Someone took the last places meanwhile: refresh what's left so the steppers show it.
  useEffect(() => {
    if (save.code === 'SOLD_OUT') void queryClient.invalidateQueries({ queryKey: liveListingKey(l.shortCode) });
  }, [save.code, queryClient, l.shortCode]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{t('title')}</DialogTitle>
          <DialogDescription>{t('maxPerOrder', { max: l.maxQtyPerOrder })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <fieldset className="flex flex-col divide-y divide-border rounded-[var(--radius)] border border-border">
            <legend className="sr-only">{t('quantity')}</legend>
            {l.options.map((o) => {
              const q = quantities[o.id] ?? 0;
              const max = maxFor(o.remaining, l.maxQtyPerOrder, chosen, q);
              return (
                <div key={o.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="flex flex-col">
                    <span className="font-medium">{o.name}</span>
                    <span className="text-sm tabular-nums text-muted-foreground">{formatCents(o.priceCents)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" className="size-11 p-0" aria-label={t('decrease', { name: o.name })} disabled={q === 0} onClick={() => setQuantity(o.id, q - 1)}>
                      −
                    </Button>
                    <output aria-live="polite" className="w-6 text-center tabular-nums">{q}</output>
                    <Button type="button" variant="outline" size="sm" className="size-11 p-0" aria-label={t('increase', { name: o.name })} disabled={q >= max} onClick={() => setQuantity(o.id, q + 1)}>
                      +
                    </Button>
                  </span>
                </div>
              );
            })}
          </fieldset>
          {needsPickup && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="pickupPointId">{t('pickup')}</Label>
              <NativeSelect id="pickupPointId" value={pickupPointId} onChange={(e) => setPickupPointId(e.target.value)}>
                <option value="">{t('choosePickup')}</option>
                {l.pickupPoints.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} · {p.address}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          {FIELDS.map(({ name, type, autoComplete }) => (
            <div key={name} className="flex flex-col gap-1">
              <Label htmlFor={name}>{t(name)}</Label>
              <Input id={name} type={type} autoComplete={autoComplete} aria-invalid={Boolean(errors[name])} {...register(name)} />
              {errors[name] && <p className="text-sm text-destructive">{errors[name].message}</p>}
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <Label htmlFor="note">{t('note')}</Label>
            <Textarea id="note" rows={2} {...register('note')} />
          </div>
          <CheckboxField label={t('anonymous')} {...register('anonymous')} />
          {(formError || save.error) && (
            <p role="alert" className="text-sm text-destructive">
              {formError ?? (save.code === 'SOLD_OUT' ? t('soldOutRefreshed') : save.error)}
            </p>
          )}
          <div className="flex items-center justify-between gap-4">
            <span className="font-display text-lg font-bold tabular-nums">{t('subtotal', { amount: formatCents(subtotal) })}</span>
            <Button type="submit" size="lg" disabled={save.saving}>
              {save.saving ? t('paying') : t('pay')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('secure')}</p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
