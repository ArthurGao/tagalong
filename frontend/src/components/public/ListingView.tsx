import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { PublicListing } from '@/lib/api/public';
import { formatNzDateTime } from '@/lib/time';
import { AvailabilityGate } from './AvailabilityGate';
import { ImageCarousel } from './ImageCarousel';
import { ListingTimeLine } from './ListingTimeLine';
import { Markdown } from './Markdown';
import { OptionList } from './OptionList';
import { RemainingBar } from './RemainingBar';
import { Section } from './Section';
import { SignUpSheet } from './SignUpSheet';
import { StickyBuyBar } from './StickyBuyBar';

/** The buyer page's body, inside a LiveListingProvider: the public page and the merchant's preview render the same. */
export function ListingView({ listing }: { listing: PublicListing }) {
  const t = useTranslations('public.listing');
  const locale = useLocale();
  return (
    <AvailabilityGate>
      <main className="mx-auto flex max-w-[480px] flex-col gap-6 px-4 pt-4 pb-32">
        <ImageCarousel images={listing.images} title={listing.title} />
        <header className="flex flex-col gap-2">
          <h1 className="font-display text-[28px] leading-tight font-bold">{listing.title}</h1>
          <p className="text-muted-foreground">
            <Link href={`/${locale}/m/${listing.merchant.slug}`} className="underline-offset-2 hover:underline">
              {t('by', { merchant: listing.merchant.displayName })}
            </Link>
            {listing.merchant.verified && <span className="ml-2 text-sm text-foreground">✓ {t('verified')}</span>}
          </p>
        </header>
        <RemainingBar />
        <ListingTimeLine />
        <OptionList />
        {listing.pickupPoints.length > 0 && (
          <Section title={t('pickupTitle')}>
            <ul className="flex flex-col gap-3">
              {listing.pickupPoints.map((p, i) => (
                <li key={i} className="flex flex-col">
                  <span className="font-medium">{p.label}</span>
                  <span className="text-sm text-muted-foreground">{p.address}</span>
                  {p.windowStart && p.windowEnd && (
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {t('window', {
                        start: formatNzDateTime(p.windowStart, locale),
                        end: formatNzDateTime(p.windowEnd, locale),
                      })}
                    </span>
                  )}
                  {p.notes && <span className="text-sm">{p.notes}</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {listing.description && (
          <Section title={t('detailsTitle')}>
            <Markdown>{listing.description}</Markdown>
          </Section>
        )}
        {listing.policyText && (
          <Section title={t('policyTitle')}>
            <p className="text-sm whitespace-pre-line text-muted-foreground">{listing.policyText}</p>
          </Section>
        )}
        <SignUpSheet />
      </main>
      <StickyBuyBar />
    </AvailabilityGate>
  );
}
