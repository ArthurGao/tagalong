import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CursorPager } from '@/components/admin/CursorPager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getAdminAuditLog } from '@/lib/api/server';
import { firstParam } from '@/lib/query-href';
import { formatNzDateTime } from '@/lib/time';

const ACTION = /^[A-Z_]{1,64}$/;

// DESIGN §9: the append-only audit log, newest first; filter by admin email, action and target.
export default async function AdminAuditLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const raw = await searchParams;
  const list = { actor: firstParam(raw.actor), action: firstParam(raw.action), targetId: firstParam(raw.targetId), cursor: firstParam(raw.cursor) };
  const action = list.action?.trim().toUpperCase();
  const [t, tFilters] = await Promise.all([getTranslations('admin.audit'), getTranslations('admin.filters')]);
  const page = await getAdminAuditLog({
    actor: list.actor?.trim() || undefined,
    action: action && ACTION.test(action) ? action : undefined,
    targetId: list.targetId?.trim() || undefined,
    cursor: list.cursor || undefined,
  });
  const path = `/${locale}/audit-log`;

  return (
    <main className="flex flex-col gap-4 px-6 py-6">
      <h1 className="text-lg font-semibold">{t('title')}</h1>
      <form action={path} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">{t('actor')}</span>
          <Input name="actor" type="email" defaultValue={list.actor ?? ''} className="h-9 w-60" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">{t('action')}</span>
          <Input name="action" defaultValue={list.action ?? ''} placeholder="PII_REVEAL" className="h-9 w-48 font-mono" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">{t('target')}</span>
          <Input name="targetId" defaultValue={list.targetId ?? ''} className="h-9 w-80 font-mono" />
        </label>
        <Button type="submit" size="sm" variant="outline">
          {tFilters('apply')}
        </Button>
      </form>

      {page?.items.length ? (
        <table className="w-full text-left">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="h-9 px-2 font-normal">{t('when')}</th>
              <th className="h-9 px-2 font-normal">{t('who')}</th>
              <th className="h-9 px-2 font-normal">{t('what')}</th>
              <th className="h-9 px-2 font-normal">{t('target')}</th>
              <th className="h-9 px-2 font-normal">{t('reason')}</th>
              <th className="h-9 px-2 font-normal">{t('details')}</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((e) => (
              <tr key={e.id} className="border-b border-border align-top">
                <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">{formatNzDateTime(e.createdAt, locale)}</td>
                <td className="px-2 py-2">
                  {e.actorEmail ?? t('system')}
                  {e.ip && <span className="block font-mono text-xs text-muted-foreground">{e.ip}</span>}
                </td>
                <td className="px-2 py-2 font-mono">{e.action}</td>
                <td className="px-2 py-2 font-mono text-xs">
                  {e.targetType}
                  <span className="block break-all text-muted-foreground">{e.targetId}</span>
                </td>
                <td className="px-2 py-2">{e.reason ?? '—'}</td>
                <td className="px-2 py-2 font-mono text-xs break-all text-muted-foreground">{Object.keys(e.metadata).length ? JSON.stringify(e.metadata) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-muted-foreground">{t('empty')}</p>
      )}

      <CursorPager path={path} list={list} nextCursor={page?.nextCursor} />
    </main>
  );
}
