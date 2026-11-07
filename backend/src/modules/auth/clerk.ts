import { createClerkClient, verifyToken } from '@clerk/backend';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { Role } from '../../generated/prisma/enums.js';

export interface VerifiedSession {
  clerkUserId: string;
}

// The Clerk SDK stays behind these two abstractions (also the DI tokens) so tests never call Clerk.
export abstract class ClerkVerifier {
  /** Verified session for a session JWT, or null when the token is invalid. */
  abstract verify(token: string): Promise<VerifiedSession | null>;
}

export abstract class ClerkAdminApi {
  abstract getPrimaryEmail(clerkUserId: string): Promise<string>;
  /** The one Clerk user whose verified primary email is this address; null when none or more than one. */
  abstract findUserIdByEmail(email: string): Promise<string | null>;
  /** Mirrors our DB role to publicMetadata.role (lower-case), which the frontend reads for routing only. */
  abstract setRole(clerkUserId: string, role: Role): Promise<void>;
}

@Injectable()
export class ClerkSdkVerifier extends ClerkVerifier {
  constructor(@Inject(ENV) private readonly env: Env) {
    super();
  }

  async verify(token: string): Promise<VerifiedSession | null> {
    if (!this.env.CLERK_JWT_KEY) return null;
    try {
      // Networkless: verified against the instance's PEM public key, azp limited to our origins.
      const payload = await verifyToken(token, {
        jwtKey: this.env.CLERK_JWT_KEY,
        authorizedParties: this.env.CLERK_AUTHORIZED_PARTIES,
      });
      return payload.sub ? { clerkUserId: payload.sub } : null;
    } catch {
      return null;
    }
  }
}

@Injectable()
export class ClerkSdkAdminApi extends ClerkAdminApi {
  private readonly client: ReturnType<typeof createClerkClient>;

  constructor(@Inject(ENV) env: Env) {
    super();
    this.client = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  }

  async getPrimaryEmail(clerkUserId: string): Promise<string> {
    const user = await this.client.users.getUser(clerkUserId);
    const email = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress;
    if (!email) throw new Error(`Clerk user ${clerkUserId} has no primary email`);
    return email;
  }

  async findUserIdByEmail(email: string): Promise<string | null> {
    // Clerk matches any address on the account, unverified secondary ones included: filter to the verified primary.
    const { data } = await this.client.users.getUserList({ emailAddress: [email], limit: 10 });
    return verifiedPrimaryMatch(data, email);
  }

  async setRole(clerkUserId: string, role: Role): Promise<void> {
    await this.client.users.updateUserMetadata(clerkUserId, { publicMetadata: { role: role.toLowerCase() } });
  }
}

interface ClerkUserEmails {
  id: string;
  primaryEmailAddressId: string | null;
  emailAddresses: { id: string; emailAddress: string; verification: { status: string } | null }[];
}

/**
 * Who an admin grant may bind to: exactly one user whose primary email is this address and verified. A match on a
 * secondary or unverified address proves nothing (anyone can add an address to their own account), and two
 * qualifying users are ambiguous; both give null.
 */
export function verifiedPrimaryMatch(users: ClerkUserEmails[], email: string): string | null {
  const wanted = email.trim().toLowerCase();
  const matches = users.filter((u) => {
    const primary = u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId);
    return primary?.verification?.status === 'verified' && primary.emailAddress.trim().toLowerCase() === wanted;
  });
  return matches.length === 1 ? matches[0].id : null;
}
