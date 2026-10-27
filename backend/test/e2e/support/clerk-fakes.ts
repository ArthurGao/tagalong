import type { Role } from '../../../src/generated/prisma/enums.js';
import type { ClerkAdminApi, ClerkVerifier, VerifiedSession } from '../../../src/modules/auth/clerk.js';

// Token format for tests: "valid:<clerkUserId>". Anything else fails verification.
export class FakeClerkVerifier implements ClerkVerifier {
  async verify(token: string): Promise<VerifiedSession | null> {
    return token.startsWith('valid:') ? { clerkUserId: token.slice('valid:'.length) } : null;
  }
}

export class FakeClerkAdminApi implements ClerkAdminApi {
  readonly users = new Map<string, string>(); // clerkUserId -> primary email
  readonly roleCalls: { clerkUserId: string; role: 'merchant' | 'admin' }[] = [];
  failSetRole = false;

  async getPrimaryEmail(clerkUserId: string): Promise<string> {
    const email = this.users.get(clerkUserId);
    if (!email) throw new Error(`unknown Clerk user ${clerkUserId}`);
    return email;
  }

  async setRole(clerkUserId: string, role: Role): Promise<void> {
    if (this.failSetRole) throw new Error('Clerk API down');
    this.roleCalls.push({ clerkUserId, role: role === 'ADMIN' ? 'admin' : 'merchant' });
  }
}
