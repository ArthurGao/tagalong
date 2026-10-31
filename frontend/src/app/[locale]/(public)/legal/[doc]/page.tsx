import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LEGAL_DOCS, type LegalDoc, LegalDocument } from '@/components/public/LegalDocument';

type Params = Promise<{ locale: string; doc: string }>;

const legalDoc = (doc: string): LegalDoc => (LEGAL_DOCS as readonly string[]).includes(doc) ? (doc as LegalDoc) : notFound();

// /legal/terms and /legal/privacy only; anything else is 404.
export const dynamicParams = false;
export const generateStaticParams = () => LEGAL_DOCS.map((doc) => ({ doc }));

// Indexed, unlike most pages (DESIGN §11: the landing and legal pages).
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, doc } = await params;
  const t = await getTranslations({ locale, namespace: 'public.legal' });
  return { title: t(`${legalDoc(doc)}.title`), robots: { index: true, follow: true } };
}

export default async function LegalPage({ params }: { params: Params }) {
  const { locale, doc } = await params;
  setRequestLocale(locale);
  return <LegalDocument doc={legalDoc(doc)} />;
}
