/**
 * Mirrors `api/src/infrastructure/exceptions/error-envelope.ts` and the codes in
 * `api/src/infrastructure/exceptions/error-codes.ts`.
 *
 * Hand-copied on purpose: the client does not import from api/. If the backend
 * envelope changes shape, this file and its test are what must be updated.
 */

export const ErrorCodes = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  /** The backend's generic 401 bucket, for a 401 with no more specific code. */
  UNAUTHORIZED: "UNAUTHORIZED",
  AUTH_INVALID_CREDENTIALS: "AUTH_INVALID_CREDENTIALS",
  AUTH_TOKEN_INVALID: "AUTH_TOKEN_INVALID",
  AUTH_TOKEN_EXPIRED: "AUTH_TOKEN_EXPIRED",
  AUTH_TOKEN_REUSE: "AUTH_TOKEN_REUSE",
  AUTH_RESET_CODE_INVALID: "AUTH_RESET_CODE_INVALID",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  FILE_MIME_NOT_ALLOWED: "FILE_MIME_NOT_ALLOWED",
  UNKNOWN: "UNKNOWN",
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes] | (string & {})

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly statusCode: number
  readonly details: unknown
  readonly correlationId?: string

  constructor(init: {
    code: ErrorCode
    message: string
    statusCode: number
    details?: unknown
    correlationId?: string
  }) {
    super(init.message)
    this.name = "ApiError"
    this.code = init.code
    this.statusCode = init.statusCode
    this.details = init.details ?? null
    this.correlationId = init.correlationId
  }

  /**
   * The one code that should trigger a refresh-and-retry. Deliberately narrow:
   * AUTH_TOKEN_INVALID and AUTH_TOKEN_REUSE mean the session is gone, and
   * retrying those would burn the refresh token for nothing.
   */
  isAuthExpiry(): boolean {
    return this.code === ErrorCodes.AUTH_TOKEN_EXPIRED
  }

  /**
   * A 401 meaning the session itself is over, so the client should tear down and
   * raise the login gate.
   *
   * Not "any 401": AUTH_INVALID_CREDENTIALS (a wrong password) and
   * AUTH_RESET_CODE_INVALID (a stale reset code) are 401s too, and both are
   * raised by endpoints the user reaches while signed OUT. Clearing state on
   * those would wipe the store out from under a failed login attempt.
   *
   * UNAUTHORIZED is in the list because it is what the API's STATUS_TO_CODE
   * fallback produces for any framework-thrown 401 — a bucket that should no
   * longer catch an expired access token now that JwtAuthGuard names the reason,
   * but which still means "the server rejected this credential and did not tell
   * us it was merely stale".
   */
  isSessionDead(): boolean {
    return (
      this.code === ErrorCodes.AUTH_TOKEN_INVALID ||
      this.code === ErrorCodes.AUTH_TOKEN_REUSE ||
      this.code === ErrorCodes.UNAUTHORIZED
    )
  }
}

interface EnvelopeShape {
  error: {
    code: string
    message: string
    statusCode: number
    details?: unknown
    /**
     * Declared `string` by the backend's ErrorEnvelope interface, but it is
     * really `req.id` from nestjs-pino, which defaults to an auto-incrementing
     * NUMBER. Verified against a live response: `"correlationId": 3489`.
     * Accepted as either and normalised to a string below.
     */
    correlationId?: string | number
  }
}

function isEnvelope(body: unknown): body is EnvelopeShape {
  if (typeof body !== "object" || body === null) return false
  const e = (body as { error?: unknown }).error
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as { code?: unknown }).code === "string"
  )
}

/**
 * Turns whatever came back on a non-2xx into a typed error. A proxy or gateway
 * can return HTML instead of the envelope, so the fallback path is not
 * theoretical.
 */
export function parseErrorEnvelope(status: number, body: unknown): ApiError {
  if (isEnvelope(body)) {
    const e = body.error
    return new ApiError({
      code: e.code,
      message: e.message || `Request failed (${status})`,
      statusCode: e.statusCode || status,
      details: e.details,
      correlationId: e.correlationId == null ? undefined : String(e.correlationId),
    })
  }
  return new ApiError({
    code: ErrorCodes.UNKNOWN,
    message: `Request failed (${status})`,
    statusCode: status,
  })
}
