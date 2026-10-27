import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { atkinson } from '@/components/merchant/fonts';
import { SurfaceClerkProvider } from '@/lib/clerk';

// Merchant sign-in and sign-up, in the merchant surface (docs/UI-STYLE.md §3).
export default async function AuthLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('auth');
  return (
    <SurfaceClerkProvider locale={locale}>
      <div data-surface="merchant" className={atkinson.variable}>
        <main className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-10 lg:flex-row lg:items-start">
          <section className="flex flex-col gap-2 lg:w-80">
            <p className="text-2xl font-bold">TagAlong</p>
            <p className="text-muted-foreground">{t('intro')}</p>
          </section>
          <section className="flex-1">{children}</section>
        </main>
      </div>
    </SurfaceClerkProvider>
  );
}
