import { beforeEach, describe, expect, it } from "vitest"
import { SESSION_STORAGE_KEY, useSessionStore } from "./session.store"

describe("session.store", () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionStore.getState().clear()
  })

  it("starts with no tokens and not refreshing", () => {
    const s = useSessionStore.getState()
    expect(s.accessToken).toBeNull()
    expect(s.refreshToken).toBeNull()
    expect(s.refreshing).toBe(false)
  })

  it("setTokens sets both the access and refresh token", () => {
    useSessionStore.getState().setTokens({ accessToken: "a-1", refreshToken: "r-1", expiresIn: 900 })
    expect(useSessionStore.getState().accessToken).toBe("a-1")
    expect(useSessionStore.getState().refreshToken).toBe("r-1")
  })

  it("setRefreshing toggles the in-flight flag", () => {
    useSessionStore.getState().setRefreshing(true)
    expect(useSessionStore.getState().refreshing).toBe(true)
    useSessionStore.getState().setRefreshing(false)
    expect(useSessionStore.getState().refreshing).toBe(false)
  })

  it("clear nulls both tokens and refreshing", () => {
    useSessionStore.getState().setTokens({ accessToken: "a-1", refreshToken: "r-1", expiresIn: 900 })
    useSessionStore.getState().setRefreshing(true)
    useSessionStore.getState().clear()
    const s = useSessionStore.getState()
    expect(s.accessToken).toBeNull()
    expect(s.refreshToken).toBeNull()
    expect(s.refreshing).toBe(false)
  })

  it("persists only the refresh token, under the new envelope", async () => {
    useSessionStore.getState().setTokens({ accessToken: "a-1", refreshToken: "r-1", expiresIn: 900 })
    await Promise.resolve()

    const stored = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY)!)
    expect(stored.state.refreshToken).toBe("r-1")
    expect(stored.state.accessToken).toBeUndefined()
  })

  it("never lets the access token reach storage, under any key", async () => {
    useSessionStore.getState().setTokens({ accessToken: "a-1", refreshToken: "r-1", expiresIn: 900 })
    await Promise.resolve()

    expect(JSON.stringify(localStorage)).not.toContain("a-1")
  })

  it("rehydrates a legacy bare-token cyb.refresh payload", async () => {
    localStorage.setItem(SESSION_STORAGE_KEY, "r-persisted")

    await useSessionStore.persist.rehydrate()

    expect(useSessionStore.getState().refreshToken).toBe("r-persisted")
  })
})
