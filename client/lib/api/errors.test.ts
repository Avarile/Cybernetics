import { describe, expect, it } from "vitest"
import { ApiError, ErrorCodes, parseErrorEnvelope } from "./errors"

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
})
