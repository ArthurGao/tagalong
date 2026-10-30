import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { queryHref } from '@/lib/query-href';

/** "First page" / "Next page" for a cursor-paged admin list, keeping its filters. */
export function CursorPager({ path, list, nextCursor }: { path: string; list: Record<string, string | undefined>; nextCursor: string | null | undefined }) {
  const t = useTranslations('admin.filters');
  return (
    <div className="flex gap-4">
      {list.cursor && (
        <Link className="text-primary underline" href={queryHref(path, list, { cursor: undefined })}>
          {t('first')}
        </Link>
      )}
      {nextCursor && (
        <Link className="text-primary underline" href={queryHref(path, list, { cursor: nextCursor })}>
          {t('next')}
        </Link>
      )}
    </div>
  );
}
