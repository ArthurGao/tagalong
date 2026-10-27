import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { cache } from 'react';
import { Markdown } from '@/components/public/Markdown';
import { MerchantListings } from '@/components/public/MerchantListings';
import { Section } from '@/components/public/Section';
import { fetchPublicMerchant } from '@/lib/api/public';

export const revalidate = 60;

type Params = Promise<{ locale: string; slug: string }>;

const getMerchant = cache((slug: string) => fetchPublicMerchant(slug, revalidate));

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const merchant = await getMerchant(slug);
  return { title: merchant?.displayName }; // noindex from the root layout (DESIGN §11)
}

export default async function MerchantPage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const [merchant, t] = await Promise.all([getMerchant(slug), getTranslations('public.merchant')]);
  if (!merchant) notFound();
  return (
    <main className="mx-auto flex max-w-[480px] flex-col gap-6 px-4 py-6">
      <header className="flex items-center gap-3">
        {merchant.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={merchant.logoUrl} alt="" className="size-14 rounded-full object-cover" />
        )}
        <h1 className="font-display text-[28px] leading-tight font-bold">{merchant.displayName}</h1>
      </header>
      {merchant.description && <Markdown>{merchant.description}</Markdown>}
      {merchant.suspended ? (
        <p role="status" className="font-medium">
          {t('suspended')}
        </p>
      ) : (
        <Section title={t('listingsTitle')}>
          <MerchantListings listings={merchant.listings} />
        </Section>
      )}
    </main>
  );
}
