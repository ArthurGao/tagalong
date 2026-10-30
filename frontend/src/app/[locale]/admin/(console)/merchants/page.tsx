import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CursorPager } from '@/components/admin/CursorPager';
import { DetailDrawer } from '@/components/admin/DetailDrawer';
import { MerchantDetail } from '@/components/admin/MerchantDetail';
import { RiskFlags } from '@/components/admin/RiskFlags';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { getAdminMerchant, getAdminMerchants } from '@/lib/api/server';
import { firstParam, queryHref } from '@/lib/query-href';
import { formatNzDateTime } from '@/lib/time';
import { cn } from '@/lib/utils';

const STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// UI-STYLE §4: a dense table, filters on top; a row opens the merchant in the right-hand drawer (?id=).
export default async function AdminMerchantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const raw = await searchParams;
  const { id, ...list } = { status: firstParam(raw.status), risk: firstParam(raw.risk), q: firstParam(raw.q), cursor: firstParam(raw.cursor), id: firstParam(raw.id) };
  const search = { ...list, id };
  const status = STATUSES.find((s) => s === search.status);
  const [t, tStatus, tFilters] = await Promise.all([
    getTranslations('admin.merchants'),
    getTranslations('admin.merchantStatus'),
    getTranslations('admin.filters'),
  ]);
  const [page, selected] = await Promise.all([
    getAdminMerchants({ status, risk: search.risk === 'true' ? 'true' : undefined, q: search.q || undefined, cursor: search.cursor || undefined }),
    id && UUID.test(id) ? getAdminMerchant(id) : null,
  ]);
  const path = `/${locale}/merchants`;

  return (
    <main className="flex flex-col gap-4 px-6 py-6">
      <h1 className="text-lg font-semibold">{t('title')}</h1>
      <form action={path} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">{tFilters('status')}</span>
          <NativeSelect name="status" defaultValue={status ?? ''} className="h-9 w-40">
            <option value="">{tFilters('all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {tStatus(s)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex h-9 items-center gap-2">
          <input type="checkbox" name="risk" value="true" defaultChecked={search.risk === 'true'} className="size-4 accent-[var(--warning)]" />
          {tFilters('riskOnly')}
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
              <th className="h-9 px-2 font-normal">{t('slug')}</th>
              <th className="h-9 px-2 font-normal">{t('name')}</th>
              <th className="h-9 px-2 font-normal">{t('email')}</th>
              <th className="h-9 px-2 font-normal">{t('status')}</th>
              <th className="h-9 px-2 font-normal">{t('risk')}</th>
              <th className="h-9 px-2 font-normal">{t('created')}</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((m) => (
              <tr
                key={m.id}
                className={cn(
                  'relative border-b border-border hover:bg-card',
                  m.riskFlags.length > 0 && 'shadow-[inset_3px_0_0_var(--warning)]',
                  m.id === search.id && 'bg-card',
                )}
              >
                <td className="h-9 px-2 font-mono">
                  {/* The link covers the whole row (after:inset-0): a row click opens the drawer, keyboard included. */}
                  <Link href={queryHref(path, list, { id: m.id })} scroll={false} className="after:absolute after:inset-0">
                    {m.slug}
                  </Link>
                </td>
                <td className="h-9 px-2">{m.displayName}</td>
                <td className="h-9 px-2 text-muted-foreground">{m.contactEmail}</td>
                <td className={cn('h-9 px-2', m.status === 'SUSPENDED' && 'text-destructive')}>{tStatus(m.status)}</td>
                <td className="h-9 px-2">
                  <RiskFlags flags={m.riskFlags} />
                </td>
                <td className="h-9 px-2 text-muted-foreground">{formatNzDateTime(m.createdAt, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-muted-foreground">{t('empty')}</p>
      )}

      <CursorPager path={path} list={list} nextCursor={page?.nextCursor} />

      {selected && (
        <DetailDrawer title={selected.displayName} closeHref={queryHref(path, list)}>
          <MerchantDetail merchant={selected} />
        </DetailDrawer>
      )}
    </main>
  );
}
