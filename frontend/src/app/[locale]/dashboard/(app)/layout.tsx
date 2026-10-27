import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireMerchant } from '@/lib/api/server';

// The merchant console needs a merchant profile; without one, onboarding comes first.
export default async function MerchantAppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const me = await requireMerchant(locale);
  if (!me.hasMerchantProfile) redirect(`/${locale}/dashboard/onboarding/profile`);
  return children;
}
