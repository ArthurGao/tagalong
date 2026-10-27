import { Bricolage_Grotesque, Figtree } from 'next/font/google';
import type { ReactNode } from 'react';
import { PublicFooter } from '@/components/public/PublicFooter';
import { WeChatBanner } from '@/components/public/WeChatBanner';

const bricolage = Bricolage_Grotesque({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-bricolage' });
const figtree = Figtree({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-figtree' });

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div data-surface="public" className={`${bricolage.variable} ${figtree.variable}`}>
      <WeChatBanner />
      {children}
      <PublicFooter />
    </div>
  );
}
