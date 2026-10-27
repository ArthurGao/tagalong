import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';
import { fetchPublicListing } from '@/lib/api/public';
import { formatPriceRange } from '@/lib/money';
import { loadCjkFont, OG_FONT_WEIGHT } from '@/lib/og-font';
import { publicSurface as c } from '@/lib/surface-tokens';

export const revalidate = 60;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'TagAlong';

const BRAND = 'TagAlong';

// The card WhatsApp/Facebook/Messenger show for a shared link (DESIGN M4): title, price, places left, seller.
export default async function Image({ params }: { params: Promise<{ locale: string; shortCode: string }> }) {
  const { locale, shortCode } = await params;
  const [listing, t] = await Promise.all([
    fetchPublicListing(shortCode, revalidate),
    getTranslations({ locale, namespace: 'public.listing' }),
  ]);
  if (!listing) return card({ title: BRAND });

  const price = listing.pricing === 'FREE' ? t('free') : formatPriceRange(listing.options.map((o) => o.priceCents));
  let places: string;
  if (listing.availability !== 'OPEN') places = t(`state.${listing.availability}`);
  else if (listing.totalRemaining !== null) places = t('remaining', { count: listing.totalRemaining });
  else places = t(`joined.${listing.pricing}`, { count: listing.joinedCount });

  return card({ title: listing.title, price, places, by: t('by', { merchant: listing.merchant.displayName }) });
}

async function card({ title, price, places, by }: { title: string; price?: string | null; places?: string; by?: string }) {
  const font = await loadCjkFont([BRAND, title, price, places, by].join(''));
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: c.background,
          color: c.foreground,
          fontFamily: font ? 'Noto Sans SC' : undefined,
        }}
      >
        <div style={{ display: 'flex', fontSize: 32, fontWeight: 700, color: c.primary }}>{BRAND}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', fontSize: 72, fontWeight: 700, lineHeight: 1.15 }}>
            {title.length > 48 ? `${title.slice(0, 47)}…` : title}
          </div>
          <div style={{ display: 'flex', gap: 40, fontSize: 44, fontWeight: 700 }}>
            {price && <span>{price}</span>}
            {places && <span style={{ color: c.primary }}>{places}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', fontSize: 32, color: c.mutedForeground }}>{by}</div>
      </div>
    ),
    {
      ...size,
      fonts: font ? [{ name: 'Noto Sans SC', data: font, weight: OG_FONT_WEIGHT, style: 'normal' }] : undefined,
    },
  );
}
