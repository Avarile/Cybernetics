import type { Reflector } from '@nestjs/core';
import { AppException, ErrorCode } from '../../infrastructure/exceptions';
import { JwtAuthGuard } from './jwt-auth.guard';

/** Mirrors what jsonwebtoken hands passport in `info`. Constructed rather than
 *  imported: the guard matches on `name`, and `jsonwebtoken` is passport-jwt's
 *  dependency, not ours. */
function jwtError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

function guard() {
  const reflector = {
    getAllAndOverride: jest.fn(() => false),
  } as unknown as Reflector;
  return new JwtAuthGuard(reflector);
}

describe('JwtAuthGuard', () => {
  it('bypasses authentication for @Public routes', () => {
    const reflector = {
      getAllAndOverride: jest.fn(() => true),
    } as unknown as Reflector;
    const g = new JwtAuthGuard(reflector);
    const context = { getHandler: () => ({}), getClass: () => ({}) } as any;
    expect(g.canActivate(context)).toBe(true);
  });

  describe('handleRequest', () => {
    it('returns the principal when the strategy produced one', () => {
      const user = { kind: 'user', userId: 'u1', role: 'user' };
      expect(guard().handleRequest(null, user, undefined)).toBe(user);
    });

    it('reports an expired access token as AUTH_TOKEN_EXPIRED', () => {
      const info = jwtError('TokenExpiredError', 'jwt expired');
      let thrown: unknown;
      try {
        guard().handleRequest(null, false, info);
      } catch (e) {
        thrown = e;
      }
      // The one recoverable 401: the client refreshes and retries on this code
      // alone, so a generic UNAUTHORIZED here silently ends the session.
      expect(thrown).toBeInstanceOf(AppException);
      expect((thrown as AppException).code).toBe(ErrorCode.AUTH_TOKEN_EXPIRED);
      expect((thrown as AppException).getStatus()).toBe(401);
    });

    it.each([
      ['JsonWebTokenError', 'invalid signature'],
      ['JsonWebTokenError', 'jwt audience invalid'],
      ['NotBeforeError', 'jwt not active'],
      ['Error', 'No auth token'],
    ])('reports %s (%s) as AUTH_TOKEN_INVALID', (name, message) => {
      let thrown: unknown;
      try {
        guard().handleRequest(null, false, jwtError(name, message));
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(AppException);
      expect((thrown as AppException).code).toBe(ErrorCode.AUTH_TOKEN_INVALID);
    });

    it('rethrows an AppException from the strategy untouched', () => {
      // JwtStrategy.validate() raises this for a revoked session; re-wrapping
      // it would replace a precise code with a generic one.
      const err = new AppException(ErrorCode.AUTH_TOKEN_INVALID, {
        message: 'Session or credential is no longer valid',
      });
      expect(() => guard().handleRequest(err, false, undefined)).toThrow(err);
    });

    it('preserves a 503 from the revocation check rather than making it a 401', () => {
      // token-validity.service.ts fails closed on a cache outage with a 503 on
      // purpose: a 401 would tell an honest client to discard good credentials
      // and stampede the login path.
      const err = new AppException(ErrorCode.CACHE_UNAVAILABLE);
      let thrown: unknown;
      try {
        guard().handleRequest(err, false, undefined);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBe(err);
      expect((thrown as AppException).getStatus()).toBe(503);
    });
  });
});
