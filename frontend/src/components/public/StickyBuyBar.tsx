'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { priceLabel } from '@/lib/money';
import { useLiveListing, usePreview } from './live-listing';
import { OrderSheet } from './OrderSheet';

// Always visible at the bottom (UI-STYLE §2): paid orders and free registrations both start here.
export function StickyBuyBar() {
  const t = useTranslations('public.listing');
  const l = useLiveListing();
  const [sheetOpen, setSheetOpen] = useState(false);
  // The merchant's preview shows the bar as buyers see it, but nothing can be ordered from it.
  const preview = usePreview();
  const open = l.availability === 'OPEN' && !preview;
  const price = priceLabel(l.pricing, l.options.map((o) => o.priceCents), { free: t('free'), from: (p) => t('priceFrom', { price: p }) });
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-[480px] items-center justify-between gap-4 px-4 py-3">
        <div className="flex flex-col">
          <span className="font-display text-2xl font-bold tabular-nums">{price}</span>
        </div>
        <Button size="lg" className="min-w-32" disabled={!open} onClick={() => setSheetOpen(true)}>
          {preview ? t('previewNoOrder') : open ? t(`buy.${l.pricing}`) : t(`state.${l.availability}`)}
        </Button>
      </div>
      {open && <OrderSheet open={sheetOpen} onOpenChange={setSheetOpen} />}
    </div>
  );
}
