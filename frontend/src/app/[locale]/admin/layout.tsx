import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

const plexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex-sans' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono' });

// Dark only. Admin host routing and the console auth gate arrive in M1; EnvBanner in M8.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div data-surface="admin" className={`dark ${plexSans.variable} ${plexMono.variable}`}>
      {children}
    </div>
  );
}
