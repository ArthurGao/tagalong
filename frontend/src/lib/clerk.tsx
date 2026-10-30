import { enUS, zhCN } from '@clerk/localizations';
import { ClerkProvider } from '@clerk/nextjs';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { Locale } from '@/lib/locale-switch';

// Clerk is wired only when its publishable key is set, so local dev and CI builds work before the
// Clerk application exists (DESIGN §16 item 8). Without it, protected pages redirect to /login,
// which explains that sign-in is not configured.
export const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

const localizations: Record<Locale, typeof enUS> = { 'zh-CN': zhCN, en: enUS };

// Clerk components take the active surface's CSS variables, so they follow docs/UI-STYLE.md tokens.
const surfaceAppearance = {
  variables: {
    colorPrimary: 'var(--primary)',
    colorBackground: 'var(--card)',
    colorText: 'var(--foreground)',
    colorTextSecondary: 'var(--muted-foreground)',
    colorDanger: 'var(--destructive)',
    colorInputBackground: 'var(--card)',
    colorInputText: 'var(--foreground)',
    borderRadius: 'var(--radius)',
    fontFamily: 'var(--surface-font-body)',
  },
};

// Shared by the merchant and admin surfaces (each passes its own data-surface around it).
export function SurfaceClerkProvider({ locale, children }: { locale: string; children: ReactNode }) {
  if (!clerkEnabled) return children;
  return (
    <ClerkProvider localization={localizations[locale as Locale] ?? enUS} appearance={surfaceAppearance}>
      {children}
    </ClerkProvider>
  );
}

export async function ClerkNotConfigured({ titleKey }: { titleKey: 'signInTitle' | 'signUpTitle' | 'adminSignInTitle' }) {
  const t = await getTranslations('auth');
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-border bg-card p-6">
      <h1 className="text-xl font-bold">{t(titleKey)}</h1>
      <p className="text-muted-foreground">{t('notConfigured')}</p>
    </div>
  );
}
