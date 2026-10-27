'use client';

import { QueryClient, QueryClientProvider, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useState } from 'react';
import { fetchParticipants, fetchPublicListing, type ParticipantPage, type PublicListing } from '@/lib/api/public';

type Availability = PublicListing['availability'];
const REFRESH_MS = 15_000; // DESIGN §11: remaining places and the sheet refresh every 15 s
const SLOW_MS = 60_000;
// Places and the sheet move only in these states.
const LIVE: ReadonlySet<Availability> = new Set(['OPEN', 'NOT_YET_OPEN', 'SOLD_OUT']);

/** Live states poll every 15 s; CLOSED / SUSPENDED / TAKEN_DOWN can still change (reopen, resume, admin restore:
 * DESIGN §5b, §9 admin) so they poll slowly; CANCELLED is terminal. */
export function listingRefreshMs(availability: Availability): number | false {
  if (LIVE.has(availability)) return REFRESH_MS;
  return availability === 'CANCELLED' ? false : SLOW_MS;
}

interface Initial {
  listing: PublicListing;
  participants: ParticipantPage | null;
}
const InitialContext = createContext<Initial | null>(null);

/** One query cache per page; the server-rendered data seeds it so the first paint needs no fetch. */
export function LiveListingProvider({ initial, children }: { initial: Initial; children: ReactNode }) {
  // staleTime: the server just rendered this data, so mounting must not refetch it.
  // retry: false — the next poll is the retry; TanStack's default 3 retries would multiply load during an outage.
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: REFRESH_MS, retry: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <InitialContext.Provider value={initial}>{children}</InitialContext.Provider>
    </QueryClientProvider>
  );
}

function useInitial(): Initial {
  const initial = useContext(InitialContext);
  if (!initial) throw new Error('LiveListingProvider is missing');
  return initial;
}

/** The listing as the server last rendered it (updates after router.refresh()); useLiveListing() is the polled one. */
export function useServerListing(): PublicListing {
  return useInitial().listing;
}

export function useLiveListing(): PublicListing {
  const { listing } = useInitial();
  const { data } = useQuery({
    queryKey: ['public-listing', listing.shortCode],
    queryFn: async () => {
      const fresh = await fetchPublicListing(listing.shortCode);
      // A published listing never becomes unknown; treat it as a failed poll and keep the last data.
      if (!fresh) throw new Error('Listing disappeared');
      return fresh;
    },
    initialData: listing,
    refetchInterval: (q) => listingRefreshMs(q.state.data?.availability ?? listing.availability),
  });
  return data;
}

export function useParticipants() {
  const { listing, participants } = useInitial();
  // From the live listing, so a sheet the merchant turns on after page load starts loading.
  const current = useLiveListing();
  return useInfiniteQuery({
    queryKey: ['participants', listing.shortCode],
    enabled: current.showParticipants,
    queryFn: async ({ pageParam }) =>
      (await fetchParticipants(listing.shortCode, pageParam)) ?? { items: [], nextCursor: null },
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    initialData: participants ? { pages: [participants], pageParams: [undefined] } : undefined,
    refetchInterval: LIVE.has(current.availability) ? REFRESH_MS : false,
  });
}
