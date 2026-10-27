'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatCents, priceSpan } from '@/lib/money';
import { useLiveListing } from './live-listing';
import { OrderSheet } from './OrderSheet';

// Always visible at the bottom (UI-STYLE §2): paid orders and free registrations both start here.
export function StickyBuyBar() {
  const t = useTranslations('public.listing');
  const l = useLiveListing();
  const [sheetOpen, setSheetOpen] = useState(false);
  const open = l.availability === 'OPEN';
  const span = priceSpan(l.options.map((o) => o.priceCents));
  const priceLabel =
    l.pricing === 'FREE' || !span
      ? t('free')
      : span.min === span.max
        ? formatCents(span.min)
        : t('priceFrom', { price: formatCents(span.min) });
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-[480px] items-center justify-between gap-4 px-4 py-3">
        <div className="flex flex-col">
          <span className="font-display text-2xl font-bold tabular-nums">{priceLabel}</span>
        </div>
        <Button size="lg" className="min-w-32" disabled={!open} onClick={() => setSheetOpen(true)}>
          {open ? t(`buy.${l.pricing}`) : t(`state.${l.availability}`)}
        </Button>
      </div>
      {open && <OrderSheet open={sheetOpen} onOpenChange={setSheetOpen} />}
    </div>
  );
}
