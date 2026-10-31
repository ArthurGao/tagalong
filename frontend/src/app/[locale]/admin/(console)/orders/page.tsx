import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AnonymizeBuyer } from '@/components/admin/AnonymizeBuyer';
import { CursorPager } from '@/components/admin/CursorPager';
import { DetailDrawer } from '@/components/admin/DetailDrawer';
import { OrderDetail } from '@/components/admin/OrderDetail';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getAdminOrder, getAdminOrders } from '@/lib/api/server';
import { formatCents } from '@/lib/money';
import { statusKey } from '@/lib/order-status';
import { firstParam, isUuid, queryHref } from '@/lib/query-href';
import { formatNzDateTime } from '@/lib/time';
import { cn } from '@/lib/utils';

// DESIGN §9: orders across merchants by code, email or phone; buyer PII masked until revealed in the drawer (?id=).
export default async function AdminOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const raw = await searchParams;
  const list = { q: firstParam(raw.q), cursor: firstParam(raw.cursor) };
  const id = firstParam(raw.id);
  const [t, tStatus, tFilters] = await Promise.all([getTranslations('admin.orders'), getTranslations('orders.status'), getTranslations('admin.filters')]);
  const [page, selected] = await Promise.all([
    getAdminOrders({ q: list.q || undefined, cursor: list.cursor || undefined }),
    isUuid(id) ? getAdminOrder(id) : null,
  ]);
  const path = `/${locale}/orders`;

  return (
    <main className="flex flex-col gap-4 px-6 py-6">
      <h1 className="text-lg font-semibold">{t('title')}</h1>
      <form action={path} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">{tFilters('search')}</span>
          <Input name="q" defaultValue={list.q ?? ''} placeholder={t('searchHint')} className="h-9 w-72" />
        </label>
        <Button type="submit" size="sm" variant="outline">
          {tFilters('apply')}
        </Button>
      </form>

      {page?.items.length ? (
        <table className="w-full text-left">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="h-9 px-2 font-normal">{t('code')}</th>
              <th className="h-9 px-2 font-normal">{t('buyer')}</th>
              <th className="h-9 px-2 font-normal">{t('listing')}</th>
              <th className="h-9 px-2 font-normal">{t('merchant')}</th>
              <th className="h-9 px-2 font-normal">{t('status')}</th>
              <th className="h-9 px-2 font-normal">{t('total')}</th>
              <th className="h-9 px-2 font-normal">{t('created')}</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((o) => (
              <tr
                key={o.id}
                className={cn('relative border-b border-border hover:bg-card', o.openDispute && 'shadow-[inset_3px_0_0_var(--warning)]', o.id === id && 'bg-card')}
              >
                <td className="h-9 px-2 font-mono">
                  {/* The link covers the whole row (after:inset-0): a row click opens the drawer, keyboard included. */}
                  <Link href={queryHref(path, list, { id: o.id })} scroll={false} className="after:absolute after:inset-0">
                    {o.publicCode}
                  </Link>
                </td>
                <td className="h-9 px-2">
                  {o.buyerName} <span className="font-mono text-muted-foreground">{o.buyerEmail}</span>
                </td>
                <td className="h-9 px-2">{o.listing.title}</td>
                <td className="h-9 px-2">{o.merchant.displayName}</td>
                <td className="h-9 px-2">{tStatus(statusKey(o))}</td>
                <td className="h-9 px-2 font-mono">{formatCents(o.totalCents)}</td>
                <td className="h-9 px-2 text-muted-foreground">{formatNzDateTime(o.createdAt, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-muted-foreground">{t('empty')}</p>
      )}

      <CursorPager path={path} list={list} nextCursor={page?.nextCursor} />

      <AnonymizeBuyer />

      {selected && (
        <DetailDrawer title={selected.publicCode} closeHref={queryHref(path, list)}>
          {/* Keyed on what a refund changes, so the amount field starts again from what is left. */}
          <OrderDetail key={`${selected.id}:${selected.refundableCents}`} order={selected} />
        </DetailDrawer>
      )}
    </main>
  );
}
