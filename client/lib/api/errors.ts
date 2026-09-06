/**
 * Mirrors `api/src/infrastructure/exceptions/error-envelope.ts` and the codes in
 * `api/src/infrastructure/exceptions/error-codes.ts`.
 *
 * Hand-copied on purpose: the client does not import from api/. If the backend
 * envelope changes shape, this file and its test are what must be updated.
 */

export const ErrorCodes = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
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
