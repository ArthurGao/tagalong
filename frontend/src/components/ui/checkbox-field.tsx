import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function CheckboxField({ label, className, ...props }: ComponentProps<'input'> & { label: ReactNode }) {
  return (
    <label className={cn('flex min-h-11 items-center gap-3', className)}>
      <input type="checkbox" className="size-5 accent-[var(--primary)]" {...props} />
      <span>{label}</span>
    </label>
  );
}
