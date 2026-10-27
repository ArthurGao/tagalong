import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../../common/errors/app-error.js';
import type { Role } from '../../generated/prisma/enums.js';
import type { AuthUser } from './auth-user.js';

export const ROLES_KEY = 'roles';

// Runs after ClerkAuthGuard, so req.user.role was just read from the DB: revocation is immediate.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || !roles.includes(user.role)) throw new AppError('FORBIDDEN', 'Not allowed for this role');
    return true;
  }
}
