import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CursorPager } from '@/components/admin/CursorPager';
import { RetryRefund } from '@/components/admin/RetryRefund';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { getAdminCancellations } from '@/lib/api/server';
import { formatCents } from '@/lib/money';
import { firstParam } from '@/lib/query-href';
import { formatNzDateTime } from '@/lib/time';

const STATUSES = ['PENDING', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_FAILURES'] as const;

// DESIGN §8.5 / §9: bulk refunds of cancelled or taken-down listings; each failed refund can be retried here.
export default async function AdminCancellationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const raw = await searchParams;
  const list = { status: firstParam(raw.status), cursor: firstParam(raw.cursor) };
  const status = STATUSES.find((s) => s === list.status);
  const [t, tListings, tFilters] = await Promise.all([getTranslations('admin.cancellations'), getTranslations('admin.listings'), getTranslations('admin.filters')]);
  const page = await getAdminCancellations({ status, cursor: list.cursor || undefined });
  const path = `/${locale}/cancellations`;

  return (
    <main className="flex flex-col gap-4 px-6 py-6">
      <h1 className="text-lg font-semibold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('hint')}</p>
      <form action={path} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">{tFilters('status')}</span>
          <NativeSelect name="status" defaultValue={status ?? ''} className="h-9 w-52">
            <option value="">{tFilters('all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {tListings(`cancellationStatus.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button type="submit" size="sm" variant="outline">
          {tFilters('apply')}
        </Button>
      </form>

      {page?.items.length ? (
        <ul className="flex flex-col gap-3">
          {page.items.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 rounded-[var(--radius)] border border-border bg-card p-4">
              <p className="flex flex-wrap items-baseline gap-2">
                <Link className="font-semibold text-primary underline" href={`/${locale}/listings?id=${c.listing.id}`}>
                  {c.listing.title}
                </Link>
                <span className="text-muted-foreground">{c.merchant.displayName}</span>
                <span className={c.failed ? 'text-destructive' : undefined}>{tListings(`cancellationStatus.${c.status}`)}</span>
                <span className="text-muted-foreground">{formatNzDateTime(c.createdAt, locale)}</span>
              </p>
              <p className="font-mono">
                {tListings('progress', { succeeded: c.succeeded, failed: c.failed, pending: c.pending, total: c.totalOrders })}
              </p>
              <p className="text-muted-foreground">{t('reason', { reason: c.reason })}</p>
              {c.failedRefunds.length > 0 && (
                <table className="w-full text-left">
                  <caption className="mb-1 text-left font-semibold">{t('failedRefunds')}</caption>
                  <tbody>
                    {c.failedRefunds.map((f) => (
                      <tr key={f.id} className="border-t border-border">
                        <td className="h-9 px-2 font-mono">
                          <Link className="text-primary underline" href={`/${locale}/orders?id=${f.orderId}`}>
                            {f.orderPublicCode}
                          </Link>
                        </td>
                        <td className="h-9 px-2 font-mono">{formatCents(f.amountCents)}</td>
                        <td className="h-9 px-2 text-muted-foreground">
                          {t('attempts', { count: f.attempts })} · {f.refused ? t('refused') : (f.lastError ?? '—')}
                        </td>
                        <td className="h-9 px-2 text-right">
                          <RetryRefund taskId={f.id} publicCode={f.orderPublicCode} amountCents={f.amountCents} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{t('empty')}</p>
      )}

      <CursorPager path={path} list={list} nextCursor={page?.nextCursor} />
    </main>
  );
}
