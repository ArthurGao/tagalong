import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { ListingEditor } from '@/components/merchant/listing-editor/ListingEditor';
import { getListing } from '@/lib/api/server';

export default async function EditListingPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const listing = await getListing(id);
  if (!listing) notFound();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <ListingEditor initial={listing} />
    </main>
  );
}
