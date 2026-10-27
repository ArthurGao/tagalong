'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ContentStep } from './ContentStep';
import { OptionsEditor } from './OptionsEditor';
import { PickupPointsEditor } from './PickupPointsEditor';
import { PublishStep } from './PublishStep';
import { SettingsStep } from './SettingsStep';
import type { Listing } from './types';

type Step = 'content' | 'options' | 'pickup' | 'settings' | 'publish';

// DESIGN §11: type → content → options/sessions → pickup/location → policy → preview & publish.
// Pricing, type and fulfilment were chosen at creation (and lock on publish), so they show as labels.
export function ListingEditor({ initial }: { initial: Listing }) {
  const t = useTranslations('listings');
  const [listing, setListing] = useState(initial);
  const steps: Step[] = ['content', 'options', ...(listing.fulfilment === 'PICKUP' ? (['pickup'] as const) : []), 'settings', 'publish'];
  const [step, setStep] = useState<Step>('content');
  const props = { listing, onSaved: setListing };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{listing.title}</h1>
        <p className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          <span>{t(`status.${listing.status}`)}</span>
          <span aria-hidden>·</span>
          <span title={t('locked')}>
            {t(`pricing.${listing.pricing}`)} · {t(`type.${listing.type}`)} · {t(`fulfilment.${listing.fulfilment}`)}
          </span>
        </p>
      </header>
      <nav aria-label={t('steps.content')} className="flex gap-1 overflow-x-auto border-b border-border">
        {steps.map((s, i) => (
          <button
            key={s}
            type="button"
            aria-current={s === step ? 'step' : undefined}
            onClick={() => setStep(s)}
            className={cn(
              'min-h-11 whitespace-nowrap border-b-2 px-3 text-sm',
              s === step ? 'border-primary font-bold' : 'border-transparent text-muted-foreground',
            )}
          >
            {i + 1}. {t(`steps.${s}`)}
          </button>
        ))}
      </nav>
      <section className="rounded-[var(--radius)] border border-border bg-card p-4 sm:p-6">
        {step === 'content' && <ContentStep {...props} />}
        {step === 'options' && <OptionsEditor {...props} />}
        {step === 'pickup' && <PickupPointsEditor {...props} />}
        {step === 'settings' && <SettingsStep {...props} />}
        {step === 'publish' && <PublishStep {...props} />}
      </section>
    </div>
  );
}
