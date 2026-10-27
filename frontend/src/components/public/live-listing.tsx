'use client';

import { QueryClient, QueryClientProvider, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useState } from 'react';
import { fetchParticipants, fetchPublicListing, type ParticipantPage, type PublicListing } from '@/lib/api/public';

const REFRESH_MS = 15_000; // DESIGN §11: remaining places and the sheet refresh every 15 s
// Only these can still change on their own; closed, cancelled or taken-down listings stop polling.
const LIVE: ReadonlySet<PublicListing['availability']> = new Set(['OPEN', 'NOT_YET_OPEN', 'SOLD_OUT']);

interface Initial {
  listing: PublicListing;
  participants: ParticipantPage | null;
}
const InitialContext = createContext<Initial | null>(null);

/** One query cache per page; the server-rendered data seeds it so the first paint needs no fetch. */
export function LiveListingProvider({ initial, children }: { initial: Initial; children: ReactNode }) {
  // staleTime: the server just rendered this data, so mounting must not refetch it.
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: REFRESH_MS } } }));
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

export function useLiveListing(): PublicListing {
  const { listing } = useInitial();
  const { data } = useQuery({
    queryKey: ['public-listing', listing.shortCode],
    queryFn: async () => (await fetchPublicListing(listing.shortCode)) ?? listing,
    initialData: listing,
    refetchInterval: (q) => (LIVE.has(q.state.data?.availability ?? listing.availability) ? REFRESH_MS : false),
  });
  return data;
}

export function useParticipants() {
  const { listing, participants } = useInitial();
  const live = LIVE.has(useLiveListing().availability);
  return useInfiniteQuery({
    queryKey: ['participants', listing.shortCode],
    enabled: listing.showParticipants,
    queryFn: async ({ pageParam }) =>
      (await fetchParticipants(listing.shortCode, pageParam)) ?? { items: [], nextCursor: null },
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    initialData: participants ? { pages: [participants], pageParams: [undefined] } : undefined,
    refetchInterval: live ? REFRESH_MS : false,
  });
}
