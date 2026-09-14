import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AppException, ErrorCode } from '../../infrastructure/exceptions';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Global authentication guard. Verifies the Bearer access token via the 'jwt'
 * passport strategy, except on routes marked `@Public()`, which pass straight
 * through (CurrentUser then resolves to the guest principal).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  /**
   * Says WHY the token was rejected, rather than the base class's blanket 401.
   *
   * `ignoreExpiration: false` in JwtStrategy means passport-jwt rejects an
   * expired token before `validate()` ever runs, handing the reason back in
   * `info` — which the inherited `handleRequest` throws away in favour of a bare
   * `UnauthorizedException`. That maps to the generic `UNAUTHORIZED` code, and
   * the browser client only refreshes on `AUTH_TOKEN_EXPIRED`: the effect was
   * that no access token expiry ever triggered a refresh, so every session died
   * silently at the 15-minute mark with an "Unauthorized" in whatever pane
   * happened to fetch first. Expiry is the one 401 that is recoverable, so it
   * has to be distinguishable from the ones that are not.
   */
  handleRequest<TUser>(err: unknown, user: TUser, info: unknown): TUser {
    // Thrown from inside `JwtStrategy.validate()`, which already raises precise
    // AppExceptions — AUTH_TOKEN_INVALID for an unusable claim set or a revoked
    // session, and CACHE_UNAVAILABLE (a 503, deliberately not a 401) when the
    // revocation check cannot run. Re-wrapping any of them here would undo that.
    if (err) throw err;
    if (user) return user;

    // Matched by name, not `instanceof`. `jsonwebtoken` is passport-jwt's
    // dependency, not ours, so importing the class would mean declaring a
    // dependency on a transitive package — and under pnpm's strict layout an
    // `instanceof` against our own copy would not even match the instance
    // passport constructed from its copy. The name is the stable contract.
    if (isNamed(info, 'TokenExpiredError')) {
      throw new AppException(ErrorCode.AUTH_TOKEN_EXPIRED, {
        message: 'Access token expired',
        cause: info,
      });
    }

    // Everything else `info` can carry: JsonWebTokenError (bad signature, wrong
    // issuer or audience), NotBeforeError, and the plain `Error: No auth token`
    // for a missing or malformed header. None are recoverable by a refresh —
    // which is precisely what AUTH_TOKEN_INVALID tells the client.
    throw new AppException(ErrorCode.AUTH_TOKEN_INVALID, {
      message: 'Access token is not valid',
      cause: info,
    });
  }
}

function isNamed(value: unknown, name: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { name?: unknown }).name === name
  );
}
