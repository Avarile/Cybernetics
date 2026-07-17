import type { UserRole } from '../../common/principal';

/** Signed into every access token; read back by JwtStrategy.validate. */
export interface AccessTokenClaims {
  sub: string; // user id or service-credential id
  role: UserRole;
  email?: string;
  kind: 'user' | 'service';
}

/**
 * Shape returned by GET /auth/me — the acting principal enriched with the
 * user's profile fields (email + display name) from the DB. `email`/`displayName`
 * are absent for non-user callers (e.g. service credentials), which have no
 * users row.
 */
export interface UserProfile {
  id: string | null;
  role?: UserRole;
  email?: string;
  displayName?: string | null;
}

/** What the login/refresh endpoints return. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // access-token lifetime, seconds
}

/** An opaque refresh token (returned to client) plus the hash we persist. */
export interface GeneratedRefreshToken {
  token: string;
  tokenHash: string;
}
