import { describe, expect, it, vi } from "vitest"
import { createAuthApi } from "./auth"
import type { ApiClient } from "../client"

function stubClient() {
  return {
    request: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  } as unknown as ApiClient & Record<string, ReturnType<typeof vi.fn>>
}

describe("createAuthApi", () => {
  it("posts credentials to /auth/login", async () => {
    const c = stubClient()
    c.post.mockResolvedValue({ accessToken: "a", refreshToken: "r", expiresIn: 900 })
    await createAuthApi(c).login({ email: "a@b.c", password: "pw" })
    expect(c.post).toHaveBeenCalledWith("/auth/login", { email: "a@b.c", password: "pw" })
  })

  it("gets the principal from /auth/me", async () => {
    const c = stubClient()
    c.get.mockResolvedValue({ id: "u1", kind: "user", role: "admin", email: "a@b.c" })
    await expect(createAuthApi(c).me()).resolves.toMatchObject({ kind: "user", role: "admin" })
    expect(c.get).toHaveBeenCalledWith("/auth/me")
  })

  it("sends the refresh token in the logout body", async () => {
    const c = stubClient()
    c.post.mockResolvedValue(null)
    await createAuthApi(c).logout("r-1")
    expect(c.post).toHaveBeenCalledWith("/auth/logout", { refreshToken: "r-1" })
  })

  it("posts to /auth/forgot-password", async () => {
    const c = stubClient()
    c.post.mockResolvedValue(null)
    await createAuthApi(c).forgotPassword("a@b.c")
    expect(c.post).toHaveBeenCalledWith("/auth/forgot-password", { email: "a@b.c" })
  })

  it("posts the reset triple matching resetPasswordSchema", async () => {
    const c = stubClient()
    c.post.mockResolvedValue(null)
    await createAuthApi(c).resetPassword({
      email: "a@b.c",
      code: "123456",
      newPassword: "correct-horse-battery",
    })
    expect(c.post).toHaveBeenCalledWith("/auth/reset-password", {
      email: "a@b.c",
      code: "123456",
      newPassword: "correct-horse-battery",
    })
  })

  it("patches /auth/password to change a password", async () => {
    const c = stubClient()
    c.patch.mockResolvedValue(null)
    await createAuthApi(c).changePassword({
      currentPassword: "old",
      newPassword: "correct-horse-battery",
    })
    expect(c.patch).toHaveBeenCalledWith("/auth/password", {
      currentPassword: "old",
      newPassword: "correct-horse-battery",
    })
  })
})
