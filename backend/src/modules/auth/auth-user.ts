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
