import type { ReactNode } from 'react';
import { requireAdmin } from '@/lib/api/server';

// The proxy already checked the Clerk role claim; this checks the DB role, which the backend
// enforces on every /api/v1/admin/* request anyway.
export default async function AdminConsoleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireAdmin(locale);
  return children;
}
