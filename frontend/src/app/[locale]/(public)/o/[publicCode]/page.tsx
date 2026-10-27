import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { OrderView } from '@/components/public/OrderView';
import { fetchOrder } from '@/lib/api/public';

type Props = {
  params: Promise<{ locale: string; publicCode: string }>;
  searchParams: Promise<{ t?: string; paid?: string }>;
};

// The buyer's private link: never indexed, never cached.
export const dynamic = 'force-dynamic';

export default async function OrderPage({ params, searchParams }: Props) {
  const [{ locale, publicCode }, { t, paid }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  if (!t) notFound();
  const order = await fetchOrder(publicCode, t);
  if (!order) notFound();
  return <OrderView initial={order} token={t} paid={paid === '1'} />;
}
