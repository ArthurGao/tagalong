import type { ReactNode } from 'react';
import { publicFontVariables } from '@/components/public/fonts';
import { PublicFooter } from '@/components/public/PublicFooter';
import { WeChatBanner } from '@/components/public/WeChatBanner';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div data-surface="public" className={publicFontVariables}>
      <WeChatBanner />
      {children}
      <PublicFooter />
    </div>
  );
}
