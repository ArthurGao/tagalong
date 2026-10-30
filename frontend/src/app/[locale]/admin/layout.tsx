import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { appEnv, EnvBanner } from '@/components/admin/EnvBanner';
import { SurfaceClerkProvider } from '@/lib/clerk';

const plexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex-sans' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono' });

// Dark only. Served on the admin host (proxy.ts rewrites into this tree); the environment banner tops every page.
export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <SurfaceClerkProvider locale={locale}>
      <div data-surface="admin" className={`dark min-h-screen bg-background ${plexSans.variable} ${plexMono.variable}`}>
        <EnvBanner env={appEnv()} />
        {children}
      </div>
    </SurfaceClerkProvider>
  );
}
