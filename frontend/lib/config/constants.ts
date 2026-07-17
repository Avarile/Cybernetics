/** Name of the readable cookie holding the rotating refresh token. */
export const REFRESH_COOKIE = 'cbn_rt'
/** Refresh-cookie lifetime in days (matches backend JWT_REFRESH_TTL = 7d). */
export const REFRESH_COOKIE_MAX_AGE_DAYS = 7
/** Fallback access-token TTL (seconds) if the server omits expiresIn. */
export const ACCESS_TTL_FALLBACK_S = 900

/** Backend error codes the frontend branches on. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_TOKEN_REUSE: 'AUTH_TOKEN_REUSE',
  FORBIDDEN: 'FORBIDDEN',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]
