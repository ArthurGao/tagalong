import { applyDecorators, createParamDecorator, type ExecutionContext, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiCookieAuth } from '@nestjs/swagger';
import type { Role } from '../../generated/prisma/enums.js';
import type { AuthUser } from './auth-user.js';
import { ClerkAuthGuard } from './clerk-auth.guard.js';
import { ROLES_KEY, RolesGuard } from './roles.guard.js';

/** Requires a Clerk session; with roles, also requires one of them (checked against the DB). */
export const Auth = (...roles: Role[]) =>
  applyDecorators(SetMetadata(ROLES_KEY, roles), UseGuards(ClerkAuthGuard, RolesGuard), ApiCookieAuth('__session'));

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => context.switchToHttp().getRequest<{ user: AuthUser }>().user,
);
