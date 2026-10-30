import { useTranslations } from 'next-intl';
import type { components } from '@/lib/api/schema';

type RiskFlag = components['schemas']['AdminMerchantRowDto']['riskFlags'][number];

/** Signal-amber badges for the merchant's risk flags (UI-STYLE §4); nothing when there are none. */
export function RiskFlags({ flags }: { flags: RiskFlag[] }) {
  const t = useTranslations('admin.risk');
  if (!flags.length) return null;
  return (
    <ul className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <li key={f} className="rounded-[var(--radius)] bg-warning px-1.5 text-xs font-medium text-warning-foreground">
          ⚠ {t(f)}
        </li>
      ))}
    </ul>
  );
}
