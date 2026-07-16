import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { Principal, UserRole } from '../principal';

/**
 * Global authorization guard (runs after JwtAuthGuard). If a route/controller
 * declares `@Roles(...)`, the request principal's role must be in the set.
 * Routes without `@Roles` are open to any authenticated principal.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const req = context.switchToHttp().getRequest<{ user?: Principal }>();
    const role: UserRole = req.user?.role ?? 'guest';
    return required.includes(role);
  }
}
