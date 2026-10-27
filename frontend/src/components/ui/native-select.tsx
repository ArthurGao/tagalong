import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { fieldClass } from './input';

// Native <select>: right for mobile (system picker) and needs no portal or JS.
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn('h-11', fieldClass, className)} {...props} />;
}
