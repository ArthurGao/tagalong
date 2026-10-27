import { SignIn } from '@clerk/nextjs';
import { setRequestLocale } from 'next-intl/server';
import { ClerkNotConfigured, clerkEnabled } from '@/lib/clerk';

// The visible URL on the admin host is /{locale}/login (proxy.ts rewrites it here). No sign-up link.
export default async function AdminLoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-6 py-16">
      {clerkEnabled ? (
        <SignIn
          path={`/${locale}/login`}
          fallbackRedirectUrl={`/${locale}`}
          appearance={{ elements: { footerAction: { display: 'none' } } }}
        />
      ) : (
        <ClerkNotConfigured titleKey="adminSignInTitle" />
      )}
    </main>
  );
}
