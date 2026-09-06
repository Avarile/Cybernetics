import { describe, expect, it, vi } from "vitest"
import { createAuthApi } from "./auth"
import type { ApiClient } from "../client"

/**
 * The mocks are returned separately from the client. Casting a single object to
 * `ApiClient & Record<string, Mock>` does not work: TS resolves `post` to the
 * ApiClient signature, which has no `mockResolvedValue`.
 */
function stubClient() {
  const mocks = {
    request: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  }
  return { mocks, client: mocks as unknown as ApiClient }
}

describe("createAuthApi", () => {
  it("posts credentials to /auth/login", async () => {
    const { mocks, client } = stubClient()
    mocks.post.mockResolvedValue({ accessToken: "a", refreshToken: "r", expiresIn: 900 })
    await createAuthApi(client).login({ email: "a@b.c", password: "pw" })
    expect(mocks.post).toHaveBeenCalledWith("/auth/login", { email: "a@b.c", password: "pw" })
  })

  it("gets the principal from /auth/me", async () => {
    const { mocks, client } = stubClient()
    mocks.get.mockResolvedValue({ id: "u1", kind: "user", role: "admin", email: "a@b.c" })
    await expect(createAuthApi(client).me()).resolves.toMatchObject({ kind: "user", role: "admin" })
    expect(mocks.get).toHaveBeenCalledWith("/auth/me")
  })

  it("sends the refresh token in the logout body", async () => {
    const { mocks, client } = stubClient()
    mocks.post.mockResolvedValue(null)
    await createAuthApi(client).logout("r-1")
    expect(mocks.post).toHaveBeenCalledWith("/auth/logout", { refreshToken: "r-1" })
  })

  it("posts to /auth/forgot-password", async () => {
    const { mocks, client } = stubClient()
    mocks.post.mockResolvedValue(null)
    await createAuthApi(client).forgotPassword("a@b.c")
    expect(mocks.post).toHaveBeenCalledWith("/auth/forgot-password", { email: "a@b.c" })
  })

  it("posts the reset triple matching resetPasswordSchema", async () => {
    const { mocks, client } = stubClient()
    mocks.post.mockResolvedValue(null)
    await createAuthApi(client).resetPassword({
      email: "a@b.c",
      code: "123456",
      newPassword: "correct-horse-battery",
    })
    expect(mocks.post).toHaveBeenCalledWith("/auth/reset-password", {
      email: "a@b.c",
      code: "123456",
      newPassword: "correct-horse-battery",
    })
  })

  it("patches /auth/password to change a password", async () => {
    const { mocks, client } = stubClient()
    mocks.patch.mockResolvedValue(null)
    await createAuthApi(client).changePassword({
      currentPassword: "old",
      newPassword: "correct-horse-battery",
    })
    expect(mocks.patch).toHaveBeenCalledWith("/auth/password", {
      currentPassword: "old",
      newPassword: "correct-horse-battery",
    })
  })
})
