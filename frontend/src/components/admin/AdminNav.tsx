'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

// Paths as the admin host serves them (proxy.ts rewrites /{locale}/x to the admin tree).
const SECTIONS = [
  { key: 'overview', path: '' },
  { key: 'merchants', path: '/merchants' },
  { key: 'listings', path: '/listings' },
  { key: 'orders', path: '/orders' },
  { key: 'cancellations', path: '/cancellations' },
  { key: 'disputes', path: '/disputes' },
  { key: 'audit', path: '/audit-log' },
] as const;

export function AdminNav() {
  const t = useTranslations('admin.nav');
  const locale = useLocale();
  const pathname = usePathname();
  return (
    <nav aria-label={t('label')} className="flex flex-row gap-1 border-b border-border p-2 md:w-44 md:flex-col md:border-r md:border-b-0">
      {SECTIONS.map(({ key, path }) => {
        const href = `/${locale}${path}`;
        const current = path === '' ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={key}
            href={href}
            aria-current={current ? 'page' : undefined}
            className={cn('rounded-[var(--radius)] px-3 py-2 hover:bg-muted', current && 'bg-card font-semibold')}
          >
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
