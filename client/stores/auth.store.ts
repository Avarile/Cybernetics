import { create } from "zustand"
import type { TokenPair, UserProfile } from "@/lib/api/types"

/**
 * The ONLY persisted auth value.
 *
 * The API sets `credentials: false` in CORS, so there is no cookie transport
 * and the refresh token has to survive a reload somehow. The access token is
 * the credential an XSS would actually want, so it stays in memory and never
 * touches storage.
 */
export const REFRESH_STORAGE_KEY = "cyb.refresh"

export type AuthStatus = "idle" | "loading" | "ready" | "error"

interface AuthState {
  principal: UserProfile | null
  accessToken: string | null
  refreshToken: string | null
  status: AuthStatus
  error: string | null

  setTokens: (pair: TokenPair) => void
  setPrincipal: (p: UserProfile) => void
  setStatus: (s: AuthStatus) => void
  setError: (message: string) => void
  clear: () => void
  readPersistedRefresh: () => string | null
}

function persistRefresh(token: string | null): void {
  if (typeof window === "undefined") return
  if (token) localStorage.setItem(REFRESH_STORAGE_KEY, token)
  else localStorage.removeItem(REFRESH_STORAGE_KEY)
}

export const useAuthStore = create<AuthState>((set) => ({
  principal: null,
  accessToken: null,
  refreshToken: null,
  status: "idle",
  error: null,

  setTokens: (pair) => {
    persistRefresh(pair.refreshToken)
    set({ accessToken: pair.accessToken, refreshToken: pair.refreshToken, error: null })
  },

  setPrincipal: (principal) => set({ principal, status: "ready", error: null }),

  // Entering `loading` clears the previous error so a retry does not render the
  // last failure alongside a spinner. Other transitions leave it alone — note
  // the conditional spread: `{ error: undefined }` would blank it, since
  // zustand merges partials with Object.assign semantics.
  setStatus: (status) =>
    set(status === "loading" ? { status, error: null } : { status }),

  setError: (error) => set({ status: "error", error }),

  clear: () => {
    persistRefresh(null)
    set({
      principal: null,
      accessToken: null,
      refreshToken: null,
      status: "idle",
      error: null,
    })
  },

  readPersistedRefresh: () =>
    typeof window === "undefined" ? null : localStorage.getItem(REFRESH_STORAGE_KEY),
}))

export const selectIsAuthenticated = (s: AuthState): boolean =>
  s.principal !== null && s.accessToken !== null
