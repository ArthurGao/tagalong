import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** A labelled Auckland date-time input with its error underneath (sessions, pickup windows, deadlines). */
export function DateTimeField({ id, label, error, ...input }: { id: string; label: string; error?: string } & ComponentProps<'input'>) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="datetime-local" aria-invalid={Boolean(error)} {...input} />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
