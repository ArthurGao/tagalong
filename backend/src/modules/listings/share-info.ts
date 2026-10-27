import { priceSpan, remainingPlaces } from './availability.js';

interface ShareSource {
  totalCapacity: number | null;
  soldCount: number;
  reservedCount: number;
  options: { active: boolean; priceCents: number; capacity: number | null; soldCount: number; reservedCount: number; startsAt: Date | null; location: string | null }[];
  pickupPoints: { label: string; createdAt: Date }[];
}

/**
 * The facts a share message quotes (DESIGN §11 分享文案): price range, places left, where and when. Places left is the
 * listing-wide cap when there is one, otherwise the sum over active options; null when any of them is unlimited.
 */
export function shareInfo(l: ShareSource) {
  const options = l.options.filter((o) => o.active);
  const perOption = options.map((o) => remainingPlaces(o.capacity, o.soldCount, o.reservedCount));
  const optionsLeft = perOption.includes(null) ? null : (perOption as number[]).reduce((n, r) => n + r, 0);
  const listingLeft = remainingPlaces(l.totalCapacity, l.soldCount, l.reservedCount);
  const remaining = listingLeft === null ? optionsLeft : optionsLeft === null ? listingLeft : Math.min(listingLeft, optionsLeft);
  const [firstPickup] = [...l.pickupPoints].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const sessions = options.filter((o) => o.startsAt).sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime());
  return {
    ...priceSpan(options.map((o) => o.priceCents)),
    remaining,
    place: firstPickup?.label ?? sessions.find((o) => o.location)?.location ?? null,
    startsAt: sessions[0]?.startsAt ?? null,
  };
}
