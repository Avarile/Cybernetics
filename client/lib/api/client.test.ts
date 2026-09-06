import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "./errors"
import { createApiClient } from "./client"

function envelope(code: string, status: number) {
  return {
    error: {
      code,
      message: code,
      statusCode: status,
      details: null,
      correlationId: "c",
      timestamp: "t",
      path: "/p",
    },
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function harness(overrides: { access?: string | null; refresh?: string | null } = {}) {
  let access = overrides.access === undefined ? "access-1" : overrides.access
  const refresh = overrides.refresh === undefined ? "refresh-1" : overrides.refresh
  const fetchImpl = vi.fn()
  const onTokens = vi.fn((p: { accessToken: string }) => {
    access = p.accessToken
  })
  const onAuthFailure = vi.fn()
  const client = createApiClient({
    baseUrl: "https://api.test",
    getAccessToken: () => access,
    getRefreshToken: () => refresh,
    onTokens,
    onAuthFailure,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  })
  return { fetchImpl, onTokens, onAuthFailure, client }
}

describe("createApiClient", () => {
  beforeEach(() => vi.clearAllMocks())

  it("prefixes the base URL and attaches the bearer token", async () => {
    const h = harness()
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({ ok: true }))
    await h.client.get("/auth/me")
    const [url, init] = h.fetchImpl.mock.calls[0]
    expect(url).toBe("https://api.test/auth/me")
    expect((init.headers as Headers).get("authorization")).toBe("Bearer access-1")
  })

  it("never sends credentials", async () => {
    const h = harness()
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({}))
    await h.client.get("/auth/me")
    expect(h.fetchImpl.mock.calls[0][1].credentials).toBe("omit")
  })

  it("omits the bearer header when there is no access token", async () => {
    const h = harness({ access: null })
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({}))
    await h.client.post("/auth/login", { email: "a@b.c", password: "x" })
    expect((h.fetchImpl.mock.calls[0][1].headers as Headers).has("authorization")).toBe(false)
  })

  it("throws a typed ApiError on a non-2xx", async () => {
    const h = harness()
    h.fetchImpl.mockResolvedValueOnce(jsonResponse(envelope("VALIDATION_FAILED", 422), 422))
    await expect(h.client.get("/x")).rejects.toBeInstanceOf(ApiError)
  })

  it("returns null for 204", async () => {
    const h = harness()
    h.fetchImpl.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(h.client.del("/files/1")).resolves.toBeNull()
  })

  it("refreshes once on an expired token and retries the request", async () => {
    const h = harness()
    h.fetchImpl
      .mockResolvedValueOnce(jsonResponse(envelope("AUTH_TOKEN_EXPIRED", 401), 401))
      .mockResolvedValueOnce(
        jsonResponse({ accessToken: "access-2", refreshToken: "refresh-2", expiresIn: 900 }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "u1" }))

    await expect(h.client.get("/auth/me")).resolves.toEqual({ id: "u1" })

    expect(h.fetchImpl).toHaveBeenCalledTimes(3)
    expect(h.fetchImpl.mock.calls[1][0]).toBe("https://api.test/auth/refresh")
    expect(h.onTokens).toHaveBeenCalledWith({
      accessToken: "access-2",
      refreshToken: "refresh-2",
      expiresIn: 900,
    })
    expect((h.fetchImpl.mock.calls[2][1].headers as Headers).get("authorization")).toBe(
      "Bearer access-2",
    )
  })

  it("collapses five concurrent 401s into exactly one refresh", async () => {
    const h = harness()
    h.fetchImpl.mockImplementation((url: string, init: RequestInit) => {
      if (url.endsWith("/auth/refresh")) {
        return Promise.resolve(
          jsonResponse({ accessToken: "access-2", refreshToken: "refresh-2", expiresIn: 900 }),
        )
      }
      const auth = (init.headers as Headers).get("authorization")
      if (auth === "Bearer access-1") {
        return Promise.resolve(jsonResponse(envelope("AUTH_TOKEN_EXPIRED", 401), 401))
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    })

    const results = await Promise.all([
      h.client.get("/a"),
      h.client.get("/b"),
      h.client.get("/c"),
      h.client.get("/d"),
      h.client.get("/e"),
    ])

    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }, { ok: true }, { ok: true }])
    const refreshCalls = h.fetchImpl.mock.calls.filter((c) =>
      String(c[0]).endsWith("/auth/refresh"),
    )
    expect(refreshCalls).toHaveLength(1)
  })

  it("retries only once — a second 401 after refresh fails the request", async () => {
    const h = harness()
    h.fetchImpl
      .mockResolvedValueOnce(jsonResponse(envelope("AUTH_TOKEN_EXPIRED", 401), 401))
      .mockResolvedValueOnce(
        jsonResponse({ accessToken: "access-2", refreshToken: "refresh-2", expiresIn: 900 }),
      )
      .mockResolvedValueOnce(jsonResponse(envelope("AUTH_TOKEN_EXPIRED", 401), 401))

    await expect(h.client.get("/auth/me")).rejects.toBeInstanceOf(ApiError)
    expect(h.fetchImpl).toHaveBeenCalledTimes(3)
  })

  it("calls onAuthFailure and throws when the refresh itself fails", async () => {
    const h = harness()
    h.fetchImpl
      .mockResolvedValueOnce(jsonResponse(envelope("AUTH_TOKEN_EXPIRED", 401), 401))
      .mockResolvedValueOnce(jsonResponse(envelope("AUTH_TOKEN_REUSE", 401), 401))

    await expect(h.client.get("/auth/me")).rejects.toBeInstanceOf(ApiError)
    expect(h.onAuthFailure).toHaveBeenCalledTimes(1)
  })

  it("does not attempt a refresh when there is no refresh token", async () => {
    const h = harness({ refresh: null })
    h.fetchImpl.mockResolvedValueOnce(jsonResponse(envelope("AUTH_TOKEN_EXPIRED", 401), 401))
    await expect(h.client.get("/auth/me")).rejects.toBeInstanceOf(ApiError)
    expect(h.fetchImpl).toHaveBeenCalledTimes(1)
    expect(h.onAuthFailure).toHaveBeenCalledTimes(1)
  })

  it("does not refresh on a 401 that is not an expiry", async () => {
    const h = harness()
    h.fetchImpl.mockResolvedValueOnce(jsonResponse(envelope("AUTH_INVALID_CREDENTIALS", 401), 401))
    await expect(h.client.post("/auth/login", {})).rejects.toBeInstanceOf(ApiError)
    expect(h.fetchImpl).toHaveBeenCalledTimes(1)
  })
})
