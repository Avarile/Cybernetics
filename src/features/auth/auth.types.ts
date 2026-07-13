import type { UserRole } from '../../common/principal';

/** Signed into every access token; read back by JwtStrategy.validate. */
export interface AccessTokenClaims {
  sub: string; // user id or service-credential id
  role: UserRole;
  email?: string;
  kind: 'user' | 'service';
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
