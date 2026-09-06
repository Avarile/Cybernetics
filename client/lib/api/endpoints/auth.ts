import type { ApiClient } from "../client"
import type { TokenPair, UserProfile } from "../types"

/** One row of `GET /auth/sessions`. */
export interface SessionRow {
  id: string
  userAgent?: string | null
  ip?: string | null
  createdAt: string
  expiresAt: string
}

/**
 * Typed wrappers over `api/src/features/auth/auth.controller.ts`.
 *
 * There is deliberately no `register` here: `users.controller.ts` is
 * admin-only provisioning and no public signup route exists. The register form
 * posts its documented-but-unbuilt contract directly — see RegisterPane.
 */
export function createAuthApi(client: ApiClient) {
  return {
    login: (body: { email: string; password: string }) =>
      client.post<TokenPair>("/auth/login", body),

    refresh: (refreshToken: string) =>
      client.post<TokenPair>("/auth/refresh", { refreshToken }),

    logout: (refreshToken: string) => client.post<null>("/auth/logout", { refreshToken }),

    logoutAll: () => client.post<null>("/auth/logout-all"),

    me: () => client.get<UserProfile>("/auth/me"),

    sessions: () => client.get<SessionRow[]>("/auth/sessions"),

    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      client.patch<null>("/auth/password", body),

    forgotPassword: (email: string) => client.post<null>("/auth/forgot-password", { email }),

    resetPassword: (body: { email: string; code: string; newPassword: string }) =>
      client.post<null>("/auth/reset-password", body),
  }
}

export type AuthApi = ReturnType<typeof createAuthApi>
