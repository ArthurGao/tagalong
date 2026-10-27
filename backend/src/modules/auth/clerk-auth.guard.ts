import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import type { AuthUser } from './auth-user.js';
import { ClerkVerifier } from './clerk.js';
import { extractSessionToken } from './session-token.js';
import { UserSyncService } from './user-sync.service.js';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(
    private readonly verifier: ClerkVerifier,
    private readonly users: UserSyncService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = extractSessionToken(req);
    const session = token ? await this.verifier.verify(token) : null;
    if (!session) throw new AppError('UNAUTHENTICATED', 'Sign in required');

    const user = await this.users.ensureUser(session.clerkUserId);
    if (user.deletedAt) throw new AppError('UNAUTHENTICATED', 'Account deleted');
    req.user = {
      id: user.id,
      clerkUserId: user.clerkUserId,
      email: user.email,
      role: user.role,
      merchantId: user.merchant?.id ?? null,
    };
    return true;
  }
}
