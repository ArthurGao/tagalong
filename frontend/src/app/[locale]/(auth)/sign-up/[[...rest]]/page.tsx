import { SignUp } from '@clerk/nextjs';
import { setRequestLocale } from 'next-intl/server';
import { ClerkNotConfigured, clerkEnabled } from '@/lib/clerk';

export default async function SignUpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!clerkEnabled) return <ClerkNotConfigured titleKey="signUpTitle" />;
  return (
    <SignUp
      path={`/${locale}/sign-up`}
      signInUrl={`/${locale}/login`}
      fallbackRedirectUrl={`/${locale}/dashboard/onboarding/profile`}
    />
  );
}
