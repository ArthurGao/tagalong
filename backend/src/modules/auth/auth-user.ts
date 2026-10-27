import { AppError } from '../../common/errors/app-error.js';
import type { Role } from '../../generated/prisma/enums.js';

/** Attached to req.user by ClerkAuthGuard; role comes from our DB, never from the JWT. */
export interface AuthUser {
  id: string;
  clerkUserId: string;
  email: string;
  role: Role;
  /** The user's merchant profile, loaded with the user so handlers need no extra lookup. */
  merchantId: string | null;
}

/** The caller's merchant id; NOT_FOUND until they have created a merchant profile. */
export function requireMerchantId(user: AuthUser): string {
  if (!user.merchantId) throw new AppError('NOT_FOUND', 'No merchant profile yet');
  return user.merchantId;
}
