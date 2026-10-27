import { Atkinson_Hyperlegible } from 'next/font/google';
import type { ReactNode } from 'react';

const atkinson = Atkinson_Hyperlegible({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-atkinson' });

// Auth gate (role MERCHANT) arrives in M1.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div data-surface="merchant" className={atkinson.variable}>
      {children}
    </div>
  );
}
