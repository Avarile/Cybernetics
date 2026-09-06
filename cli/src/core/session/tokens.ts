/** What the CLI persists. `expiresAt` is absolute ms, unlike the API's relative `expiresIn`. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** The literal body of POST /auth/login and POST /auth/refresh. */
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Treat a token as expired this far before it actually is.
 *
 * Without the margin a token that passes the check can still expire between
 * the check and the server reading it, producing a 401 the CLI then has to
 * recover from — which costs a lock acquisition and a round trip.
 */
export const EXPIRY_SKEW_MS = 30_000;

export function isExpired(
  pair: TokenPair,
  now: number = Date.now(),
  skewMs: number = EXPIRY_SKEW_MS,
): boolean {
  return pair.expiresAt - skewMs <= now;
}

export function pairFromLogin(
  res: LoginResponse,
  now: number = Date.now(),
): TokenPair {
  return {
    accessToken: res.accessToken,
    refreshToken: res.refreshToken,
    expiresAt: now + res.expiresIn * 1000,
  };
}
