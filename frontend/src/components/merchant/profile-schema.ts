import { z } from 'zod';
import { PHONE } from '@/lib/validation';

// Same patterns as backend CreateMerchantDto (profile-schema.test.ts checks they stay identical);
// the backend stays the authority.
export const SLUG = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
export const GST = /^\d{2,3}-?\d{3}-?\d{3}$/;

export type ValidationKey = 'slug' | 'required' | 'email' | 'phone' | 'gst';

export const profileSchema = (message: (key: ValidationKey) => string) =>
  z.object({
    slug: z.string().regex(SLUG, message('slug')),
    displayName: z.string().trim().min(1, message('required')).max(60),
    contactEmail: z.email(message('email')),
    contactPhone: z.string().regex(PHONE, message('phone')),
    gstNumber: z.union([z.literal(''), z.string().regex(GST, message('gst'))]),
    description: z.string().max(2000),
  });

export type ProfileValues = z.infer<ReturnType<typeof profileSchema>>;
