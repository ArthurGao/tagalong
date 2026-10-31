import { SignUp } from '@clerk/nextjs';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ClerkNotConfigured, clerkEnabled } from '@/lib/clerk';

export default async function SignUpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!clerkEnabled) return <ClerkNotConfigured titleKey="signUpTitle" />;
  const t = await getTranslations('auth');
  return (
    <div className="flex flex-col items-center gap-3">
      <SignUp
        path={`/${locale}/sign-up`}
        signInUrl={`/${locale}/login`}
        fallbackRedirectUrl={`/${locale}/dashboard/onboarding/profile`}
      />
      {/* DESIGN §10: merchant account data sits with Clerk offshore (IPP 12), said before signing up. */}
      <p className="max-w-sm text-center text-sm text-muted-foreground">
        <Link href={`/${locale}/legal/privacy`} className="underline">
          {t('crossBorder')}
        </Link>
      </p>
    </div>
  );
}
