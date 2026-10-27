import type { ReactNode } from 'react';
import { atkinson } from '@/components/merchant/fonts';
import { LocaleSwitch } from '@/components/merchant/LocaleSwitch';
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
        <div className="mx-auto flex max-w-3xl justify-end px-4 pt-2">
          <LocaleSwitch />
        </div>
        {children}
      </div>
    </SurfaceClerkProvider>
  );
}
