import type { ReactNode } from 'react';
import { atkinson } from '@/components/merchant/fonts';
import { SurfaceClerkProvider } from '@/lib/clerk';

export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <SurfaceClerkProvider locale={locale}>
      <div data-surface="merchant" className={atkinson.variable}>
        {children}
      </div>
    </SurfaceClerkProvider>
  );
}
