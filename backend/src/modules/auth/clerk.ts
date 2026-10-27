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

  async setRole(clerkUserId: string, role: Role): Promise<void> {
    await this.client.users.updateUserMetadata(clerkUserId, { publicMetadata: { role: role.toLowerCase() } });
  }
}
