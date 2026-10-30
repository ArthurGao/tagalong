import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type AppEnv = 'production' | 'staging' | 'development';

/** NEXT_PUBLIC_APP_ENV, anything unknown counting as local development. */
export function appEnv(value = process.env.NEXT_PUBLIC_APP_ENV): AppEnv {
  return value === 'production' || value === 'staging' ? value : 'development';
}

// Always on top of the console (DESIGN §11): red in production, amber on staging, so nobody mistakes live data.
export function EnvBanner({ env }: { env: AppEnv }) {
  const t = useTranslations('admin.env');
  return (
    <div
      role="note"
      data-env={env}
      className={cn(
        'px-4 py-1 text-center text-xs font-semibold tracking-wide',
        env === 'production' && 'bg-destructive text-white',
        env === 'staging' && 'bg-warning text-warning-foreground',
        env === 'development' && 'bg-muted text-muted-foreground',
      )}
    >
      {t(env)}
    </div>
  );
}
