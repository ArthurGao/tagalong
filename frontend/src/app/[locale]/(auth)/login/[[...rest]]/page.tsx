import { SignIn } from '@clerk/nextjs';
import { setRequestLocale } from 'next-intl/server';
import { ClerkNotConfigured, clerkEnabled } from '@/lib/clerk';

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!clerkEnabled) return <ClerkNotConfigured titleKey="signInTitle" />;
  return (
    <SignIn
      path={`/${locale}/login`}
      signUpUrl={`/${locale}/sign-up`}
      fallbackRedirectUrl={`/${locale}/dashboard`}
    />
  );
}
