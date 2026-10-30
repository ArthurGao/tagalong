import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RiskFlags } from '@/components/admin/RiskFlags';
import { getAdminDisputes, getAdminMerchants, getAdminStats } from '@/lib/api/server';
import { formatCents } from '@/lib/money';

const TODO_ROWS = 10;

// DESIGN §11 / UI-STYLE §4: four numbers and a to-do list, nothing decorative.
export default async function AdminOverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('admin.home');
  const [stats, risky, disputes] = await Promise.all([getAdminStats(), getAdminMerchants({ risk: 'true' }), getAdminDisputes({ status: 'open', limit: TODO_ROWS })]);
  const numbers = stats
    ? [
        { label: t('newMerchantsToday'), value: String(stats.newMerchantsToday) },
        { label: t('gmv7d'), value: formatCents(stats.gmv7dCents) },
        { label: t('gmv30d'), value: formatCents(stats.gmv30dCents) },
        { label: t('openDisputes'), value: String(stats.openDisputes) },
      ]
    : [];
  const riskyRows = risky?.items.slice(0, TODO_ROWS) ?? [];
  const disputeRows = disputes ?? [];

  return (
    <main className="flex flex-col gap-6 px-6 py-6">
      <h1 className="text-lg font-semibold">{t('title')}</h1>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {numbers.map((n) => (
          <div key={n.label} className="rounded-[var(--radius)] border border-border bg-card p-4">
            <dt className="text-muted-foreground">{n.label}</dt>
            <dd className="mt-1 font-mono text-2xl">{n.value}</dd>
          </div>
        ))}
      </dl>
      <section className="flex flex-col gap-4">
        <h2 className="font-semibold">{t('todo')}</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-[var(--radius)] border border-border bg-card p-4">
            <h3 className="mb-2 text-muted-foreground">{t('riskyMerchants')}</h3>
            {riskyRows.length ? (
              <ul className="flex flex-col gap-2">
                {riskyRows.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2">
                    <Link className="text-primary underline" href={`/${locale}/merchants?id=${m.id}`}>
                      {m.displayName}
                    </Link>
                    <RiskFlags flags={m.riskFlags} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">{t('nothing')}</p>
            )}
          </div>
          <div className="rounded-[var(--radius)] border border-border bg-card p-4">
            <h3 className="mb-2 text-muted-foreground">{t('openDisputeList')}</h3>
            {disputeRows.length ? (
              <ul className="flex flex-col gap-2">
                {disputeRows.map((d) => (
                  <li key={d.id}>
                    <Link className="text-primary underline" href={`/${locale}/merchants?id=${d.merchant.id}`}>
                      {t('disputeLine', { code: d.orderPublicCode, merchant: d.merchant.displayName, amount: formatCents(d.amountCents), status: d.status })}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">{t('nothing')}</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
