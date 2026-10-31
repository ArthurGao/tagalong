import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { cache } from 'react';
import { OrderView } from '@/components/public/OrderView';
import { fetchOrder } from '@/lib/api/public';

type Props = {
  params: Promise<{ locale: string; publicCode: string }>;
  searchParams: Promise<{ t?: string; paid?: string }>;
};

// The buyer's private link: never indexed, never cached.
export const dynamic = 'force-dynamic';

// One request per render: the tab title and the page read the same order.
const loadOrder = cache((publicCode: string, token: string) => fetchOrder(publicCode, token));

// The tab says which order this is (the listing and its code), not just the site name.
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ locale, publicCode }, { t }] = await Promise.all([params, searchParams]);
  const order = t ? await loadOrder(publicCode, t) : null;
  if (!order) return {};
  const tOrder = await getTranslations({ locale, namespace: 'public.order' });
  return { title: `${order.listing.title} · ${tOrder(order.isFree ? 'titleFree' : 'title', { code: order.publicCode })}` };
}

export default async function OrderPage({ params, searchParams }: Props) {
  const [{ locale, publicCode }, { t, paid }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  if (!t) notFound();
  const order = await loadOrder(publicCode, t);
  if (!order) notFound();
  return <OrderView initial={order} token={t} paid={paid === '1'} />;
}
