import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// Shared by Input, Textarea and NativeSelect so the three controls stay visually identical.
export const fieldClass =
  'w-full rounded-[var(--radius)] border border-input bg-card px-3 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-invalid:border-destructive';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-11', fieldClass,
        className,
      )}
      {...props}
    />
  );
}
