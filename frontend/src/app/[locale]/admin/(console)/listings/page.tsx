import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CursorPager } from '@/components/admin/CursorPager';
import { DetailDrawer } from '@/components/admin/DetailDrawer';
import { ListingDetail } from '@/components/admin/ListingDetail';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { getAdminListing, getAdminListings } from '@/lib/api/server';
import { listingStatusKey } from '@/lib/listing-status';
import { firstParam, isUuid, queryHref } from '@/lib/query-href';
import { formatNzDateTime } from '@/lib/time';
import { cn } from '@/lib/utils';

const STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED', 'CANCELLED'] as const;
const PRICINGS = ['PAID', 'FREE'] as const;

// Every merchant's listings (DESIGN §11): filter by merchant, status and pricing; a row opens the drawer (?id=).
export default async function AdminListingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const raw = await searchParams;
  const search = {
    merchantId: firstParam(raw.merchantId),
    status: firstParam(raw.status),
    pricing: firstParam(raw.pricing),
    q: firstParam(raw.q),
    cursor: firstParam(raw.cursor),
    id: firstParam(raw.id),
  };
  const status = STATUSES.find((s) => s === search.status);
  const pricing = PRICINGS.find((p) => p === search.pricing);
  const merchantId = isUuid(search.merchantId) ? search.merchantId : undefined;
  const [t, tStatus, tPricing, tFilters] = await Promise.all([
    getTranslations('admin.listings'),
    getTranslations('admin.listingStatus'),
    getTranslations('listings.pricing'),
    getTranslations('admin.filters'),
  ]);
  const [page, selected] = await Promise.all([
    getAdminListings({ merchantId, status, pricing, q: search.q || undefined, cursor: search.cursor || undefined }),
    isUuid(search.id) ? getAdminListing(search.id) : null,
  ]);
  const path = `/${locale}/listings`;
  const list = { merchantId, status: search.status, pricing: search.pricing, q: search.q, cursor: search.cursor };

  return (
    <main className="flex flex-col gap-4 px-6 py-6">
      <h1 className="text-lg font-semibold">{t('title')}</h1>
      <form action={path} className="flex flex-wrap items-end gap-2">
        {merchantId && <input type="hidden" name="merchantId" value={merchantId} />}
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">{tFilters('status')}</span>
          <NativeSelect name="status" defaultValue={status ?? ''} className="h-9 w-36">
            <option value="">{tFilters('all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {tStatus(s)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">{tFilters('pricing')}</span>
          <NativeSelect name="pricing" defaultValue={pricing ?? ''} className="h-9 w-32">
            <option value="">{tFilters('all')}</option>
            {PRICINGS.map((p) => (
              <option key={p} value={p}>
                {tPricing(p)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">{tFilters('search')}</span>
          <Input name="q" defaultValue={search.q ?? ''} placeholder={t('searchHint')} className="h-9 w-64" />
        </label>
        <Button type="submit" size="sm" variant="outline">
          {tFilters('apply')}
        </Button>
      </form>

      {page?.items.length ? (
        <table className="w-full text-left">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="h-9 px-2 font-normal">{t('listing')}</th>
              <th className="h-9 px-2 font-normal">{t('merchant')}</th>
              <th className="h-9 px-2 font-normal">{t('status')}</th>
              <th className="h-9 px-2 font-normal">{t('pricing')}</th>
              <th className="h-9 px-2 font-normal">{t('sold')}</th>
              <th className="h-9 px-2 font-normal">{t('created')}</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((l) => (
              <tr key={l.id} className={cn('relative border-b border-border hover:bg-card', l.id === search.id && 'bg-card')}>
                <td className="h-9 px-2">
                  {/* The link covers the whole row (after:inset-0): a row click opens the drawer, keyboard included. */}
                  <Link href={queryHref(path, list, { id: l.id })} scroll={false} className="after:absolute after:inset-0">
                    {l.title}
                  </Link>{' '}
                  <span className="font-mono text-muted-foreground">{l.shortCode}</span>
                </td>
                <td className="h-9 px-2">{l.merchant.displayName}</td>
                <td className={cn('h-9 px-2', l.takenDown && 'text-destructive')}>{tStatus(listingStatusKey(l))}</td>
                <td className="h-9 px-2">{tPricing(l.pricing)}</td>
                <td className="h-9 px-2 font-mono">{l.soldCount}</td>
                <td className="h-9 px-2 text-muted-foreground">{formatNzDateTime(l.createdAt, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-muted-foreground">{t('empty')}</p>
      )}

      <CursorPager path={path} list={list} nextCursor={page?.nextCursor} />

      {selected && (
        <DetailDrawer title={selected.title} closeHref={queryHref(path, list)}>
          <ListingDetail listing={selected} />
        </DetailDrawer>
      )}
    </main>
  );
}
