import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { getAdminDisputes } from '@/lib/api/server';
import { formatCents } from '@/lib/money';
import { firstParam } from '@/lib/query-href';
import { formatNzDateTime } from '@/lib/time';

const STATUSES = ['open', 'closed'] as const;

// DESIGN §9: Stripe disputes as the charge.dispute.* webhooks keep them; the evidence itself is answered in Stripe.
export default async function AdminDisputesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const requested = firstParam((await searchParams).status);
  const status = STATUSES.find((s) => s === requested);
  const [t, tFilters] = await Promise.all([getTranslations('admin.disputes'), getTranslations('admin.filters')]);
  const disputes = (await getAdminDisputes({ status })) ?? [];
  const path = `/${locale}/disputes`;

  return (
    <main className="flex flex-col gap-4 px-6 py-6">
      <h1 className="text-lg font-semibold">{t('title')}</h1>
      <form action={path} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">{tFilters('status')}</span>
          <NativeSelect name="status" defaultValue={status ?? ''} className="h-9 w-36">
            <option value="">{tFilters('all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(s)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button type="submit" size="sm" variant="outline">
          {tFilters('apply')}
        </Button>
      </form>

      {disputes.length ? (
        <table className="w-full text-left">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="h-9 px-2 font-normal">{t('order')}</th>
              <th className="h-9 px-2 font-normal">{t('listing')}</th>
              <th className="h-9 px-2 font-normal">{t('merchant')}</th>
              <th className="h-9 px-2 font-normal">{t('amount')}</th>
              <th className="h-9 px-2 font-normal">{t('reason')}</th>
              <th className="h-9 px-2 font-normal">{t('status')}</th>
              <th className="h-9 px-2 font-normal">{t('created')}</th>
              <th className="h-9 px-2 font-normal">{t('closedAt')}</th>
            </tr>
          </thead>
          <tbody>
            {disputes.map((d) => (
              <tr key={d.id} className={d.open ? 'border-b border-border shadow-[inset_3px_0_0_var(--warning)]' : 'border-b border-border'}>
                <td className="h-9 px-2 font-mono">
                  <Link className="text-primary underline" href={`/${locale}/orders?q=${encodeURIComponent(d.orderPublicCode)}`}>
                    {d.orderPublicCode}
                  </Link>
                </td>
                <td className="h-9 px-2">{d.listingTitle}</td>
                <td className="h-9 px-2">
                  <Link className="text-primary underline" href={`/${locale}/merchants?id=${d.merchant.id}`}>
                    {d.merchant.displayName}
                  </Link>
                </td>
                <td className="h-9 px-2 font-mono">{formatCents(d.amountCents)}</td>
                <td className="h-9 px-2 font-mono">{d.reason}</td>
                <td className="h-9 px-2 font-mono">{d.status}</td>
                <td className="h-9 px-2 text-muted-foreground">{formatNzDateTime(d.createdAt, locale)}</td>
                <td className="h-9 px-2 text-muted-foreground">{d.closedAt ? formatNzDateTime(d.closedAt, locale) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-muted-foreground">{t('empty')}</p>
      )}
    </main>
  );
}
