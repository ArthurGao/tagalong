import { z } from 'zod';
import { PHONE } from '@/lib/validation';

// Mirrors the backend CreateOrderDto (the backend stays the authority).

export type BuyerValues = { name: string; email: string; phone: string; note: string; anonymous: boolean };

export function buyerSchema(message: (key: 'name' | 'email' | 'phone') => string) {
  return z.object({
    name: z.string().trim().min(1, message('name')).max(60, message('name')),
    email: z.string().trim().max(254, message('email')).pipe(z.email(message('email'))),
    phone: z.string().trim().regex(PHONE, message('phone')),
    note: z.string().max(500),
    anonymous: z.boolean(),
  });
}

/** How many more of one option fit: its remaining places and the per-order limit. */
export function maxFor(remaining: number | null, maxPerOrder: number, chosenTotal: number, chosenHere: number): number {
  const byOrder = maxPerOrder - (chosenTotal - chosenHere);
  return Math.max(0, remaining === null ? byOrder : Math.min(remaining, byOrder));
}
