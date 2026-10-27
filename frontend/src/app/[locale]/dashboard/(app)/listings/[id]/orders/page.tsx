import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { OrderList } from '@/components/merchant/OrderList';
import { getListingOrders } from '@/lib/api/server';

export default async function ListingOrdersPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const data = await getListingOrders(id);
  if (!data) notFound();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <OrderList initial={data} />
    </main>
  );
}
