import { describe, expect, it } from "vitest"
import { ApiError, ErrorCodes, parseErrorEnvelope } from "./errors"

/** A parsed 401 envelope carrying `code`, for the auth predicate cases. */
function auth401(code: string): ApiError {
  return parseErrorEnvelope(401, {
    error: { code, message: code, statusCode: 401 },
  })
}

describe("parseErrorEnvelope", () => {
  it("reads a well-formed envelope", () => {
    const err = parseErrorEnvelope(401, {
      error: {
        code: "AUTH_TOKEN_EXPIRED",
        message: "Access token expired",
        statusCode: 401,
        details: null,
        correlationId: "abc-123",
        timestamp: "2026-09-06T00:00:00.000Z",
        path: "/auth/me",
      },
    })
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe(ErrorCodes.AUTH_TOKEN_EXPIRED)
    expect(err.statusCode).toBe(401)
    expect(err.correlationId).toBe("abc-123")
    expect(err.message).toBe("Access token expired")
  })

  it("normalises a numeric correlationId to a string", () => {
    // Verified against the live API: nestjs-pino's req.id is a number, despite
    // the backend's ErrorEnvelope interface declaring `correlationId: string`.
    const err = parseErrorEnvelope(401, {
      error: {
        code: "AUTH_INVALID_CREDENTIALS",
        message: "Invalid credentials",
        statusCode: 401,
        details: null,
        correlationId: 3489,
        timestamp: "2026-09-06T03:17:15.116Z",
        path: "/auth/login",
      },
    })
    expect(err.correlationId).toBe("3489")
  })

  it("leaves correlationId undefined when absent", () => {
    const err = parseErrorEnvelope(500, {
      error: { code: "X", message: "m", statusCode: 500 },
    })
    expect(err.correlationId).toBeUndefined()
  })

  it("falls back when the body is not an envelope", () => {
    const err = parseErrorEnvelope(502, "<html>bad gateway</html>")
    expect(err.code).toBe("UNKNOWN")
    expect(err.statusCode).toBe(502)
    expect(err.message).toMatch(/502/)
  })

  it("falls back when the body is null", () => {
    const err = parseErrorEnvelope(500, null)
    expect(err.code).toBe("UNKNOWN")
    expect(err.statusCode).toBe(500)
  })

  it("keeps details for non-internal errors", () => {
    const err = parseErrorEnvelope(422, {
      error: {
        code: "VALIDATION_FAILED",
        message: "Invalid",
        statusCode: 422,
        details: { fieldErrors: { email: ["required"] } },
        correlationId: "c",
        timestamp: "t",
        path: "/auth/login",
      },
    })
    expect(err.details).toEqual({ fieldErrors: { email: ["required"] } })
  })

  it("isAuthExpiry only matches the expiry code", () => {
    const expired = parseErrorEnvelope(401, {
      error: {
        code: "AUTH_TOKEN_EXPIRED",
        message: "",
        statusCode: 401,
        details: null,
        correlationId: "",
        timestamp: "",
        path: "",
      },
    })
    const invalid = parseErrorEnvelope(401, {
      error: {
        code: "AUTH_TOKEN_INVALID",
        message: "",
        statusCode: 401,
        details: null,
        correlationId: "",
        timestamp: "",
        path: "",
      },
    })
    expect(expired.isAuthExpiry()).toBe(true)
    expect(invalid.isAuthExpiry()).toBe(false)
  })

  it("isAuthExpiry does not match the generic 401 bucket", () => {
    // The regression this pins: the API's STATUS_TO_CODE fallback turns any
    // framework-thrown 401 into UNAUTHORIZED, and treating that as an expiry
    // would spend a refresh on tokens that are genuinely dead.
    expect(auth401("UNAUTHORIZED").isAuthExpiry()).toBe(false)
  })

  it("isSessionDead matches the codes that end a session", () => {
    expect(auth401("AUTH_TOKEN_INVALID").isSessionDead()).toBe(true)
    expect(auth401("AUTH_TOKEN_REUSE").isSessionDead()).toBe(true)
    expect(auth401("UNAUTHORIZED").isSessionDead()).toBe(true)
  })

  it("isSessionDead spares the signed-out 401s", () => {
    // Both are 401s raised while the user is signed OUT. Tearing down client
    // state on either would clear the store under a failed login attempt.
    expect(auth401("AUTH_INVALID_CREDENTIALS").isSessionDead()).toBe(false)
    expect(auth401("AUTH_RESET_CODE_INVALID").isSessionDead()).toBe(false)
    // An expiry is recoverable, so it is not "dead" either — it is the one
    // code that routes to a refresh instead of a teardown.
    expect(auth401("AUTH_TOKEN_EXPIRED").isSessionDead()).toBe(false)
  })
})
