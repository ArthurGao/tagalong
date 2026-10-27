import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { fieldClass } from './input';

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn('min-h-24 py-2', fieldClass, className)} {...props} />;
}
