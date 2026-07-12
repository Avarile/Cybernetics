import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { FilePrincipal } from './file.types';

/**
 * Resolves the acting principal for a request.
 *
 * PLACEHOLDER for a real auth module: it currently trusts an `x-user-id`
 * header, falling back to the system principal. Replace the extraction with
 * verified identity (e.g. from an AuthGuard) when auth lands — the controller
 * and service signatures don't change.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): FilePrincipal => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.header('x-user-id');
    return { id: header && header.length > 0 ? header : null };
  },
);
