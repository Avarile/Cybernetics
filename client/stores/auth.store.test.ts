import { beforeEach, describe, expect, it } from "vitest"
import { REFRESH_STORAGE_KEY, selectIsAuthenticated, useAuthStore } from "./auth.store"

describe("auth.store", () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.getState().clear()
  })

  it("starts unauthenticated and idle", () => {
    const s = useAuthStore.getState()
    expect(s.principal).toBeNull()
    expect(s.accessToken).toBeNull()
    expect(s.status).toBe("idle")
    expect(selectIsAuthenticated(s)).toBe(false)
  })

  it("stores the access token in memory and persists ONLY the refresh token", () => {
    useAuthStore.getState().setTokens({ accessToken: "a-1", refreshToken: "r-1", expiresIn: 900 })
    expect(useAuthStore.getState().accessToken).toBe("a-1")
    expect(localStorage.getItem(REFRESH_STORAGE_KEY)).toBe("r-1")
    // the access token must never reach storage, under any key
    expect(JSON.stringify(localStorage)).not.toContain("a-1")
  })

  it("is authenticated once a principal and access token are present", () => {
    useAuthStore.getState().setTokens({ accessToken: "a-1", refreshToken: "r-1", expiresIn: 900 })
    useAuthStore.getState().setPrincipal({ id: "u1", kind: "user", role: "user" })
    expect(selectIsAuthenticated(useAuthStore.getState())).toBe(true)
    expect(useAuthStore.getState().status).toBe("ready")
  })

  it("is NOT authenticated with a principal but no access token", () => {
    useAuthStore.getState().setPrincipal({ id: "u1", kind: "user" })
    expect(selectIsAuthenticated(useAuthStore.getState())).toBe(false)
  })

  it("clear() wipes memory and storage", () => {
    useAuthStore.getState().setTokens({ accessToken: "a-1", refreshToken: "r-1", expiresIn: 900 })
    useAuthStore.getState().setPrincipal({ id: "u1", kind: "user" })
    useAuthStore.getState().clear()
    const s = useAuthStore.getState()
    expect(s.principal).toBeNull()
    expect(s.accessToken).toBeNull()
    expect(s.refreshToken).toBeNull()
    expect(s.status).toBe("idle")
    expect(localStorage.getItem(REFRESH_STORAGE_KEY)).toBeNull()
  })

  it("rehydrates the refresh token from storage", () => {
    localStorage.setItem(REFRESH_STORAGE_KEY, "r-persisted")
    expect(useAuthStore.getState().readPersistedRefresh()).toBe("r-persisted")
  })

  it("records an error and moves to the error status", () => {
    useAuthStore.getState().setError("Invalid credentials")
    const s = useAuthStore.getState()
    expect(s.status).toBe("error")
    expect(s.error).toBe("Invalid credentials")
  })

  it("setStatus('loading') clears any previous error", () => {
    useAuthStore.getState().setError("boom")
    useAuthStore.getState().setStatus("loading")
    expect(useAuthStore.getState().error).toBeNull()
    expect(useAuthStore.getState().status).toBe("loading")
  })

  it("setStatus('ready') preserves an existing error rather than blanking it", () => {
    useAuthStore.getState().setError("boom")
    useAuthStore.getState().setStatus("ready")
    expect(useAuthStore.getState().error).toBe("boom")
  })
})
