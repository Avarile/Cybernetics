import { create } from "zustand"
import { persist } from "zustand/middleware"
import { immer } from "zustand/middleware/immer"
import { readLegacyRefresh } from "@/lib/state/legacy-storage"
import { createLegacyAwareStorage } from "@/lib/state/persist-storage"
import type { TokenPair } from "@/lib/api/types"

export const SESSION_STORAGE_KEY = "cyb.refresh"

interface PersistedSession {
  refreshToken: string | null
}

interface SessionState extends PersistedSession {
  accessToken: string | null
  /** True only while the boot-time refresh exchange is in flight. SWR cannot
   *  know about it: the exchange happens below the cache. */
  refreshing: boolean
  setTokens: (pair: TokenPair) => void
  setRefreshing: (value: boolean) => void
  clear: () => void
}

/**
 * Tokens, and nothing else.
 *
 * The principal moved to SWR (`useSession`): it is the server's truth, it has a
 * cache key, and keeping a copy here meant a hand-rolled status machine that
 * mirrored what SWR already tracks.
 *
 * Only the refresh token is persisted. The API sets `credentials: false` in
 * CORS, so there is no cookie transport and the refresh token has to survive a
 * reload somehow; the access token is the credential an XSS would actually want,
 * so it stays in memory and never touches storage.
 */
export const useSessionStore = create<SessionState>()(
  persist(
    immer((set) => ({
      accessToken: null,
      refreshToken: null,
      refreshing: false,

      setTokens: (pair) =>
        set((state) => {
          state.accessToken = pair.accessToken
          state.refreshToken = pair.refreshToken
        }),

      setRefreshing: (value) =>
        set((state) => {
          state.refreshing = value
        }),

      clear: () =>
        set((state) => {
          state.accessToken = null
          state.refreshToken = null
          state.refreshing = false
        }),
    })),
    {
      name: SESSION_STORAGE_KEY,
      version: 1,
      skipHydration: true,
      partialize: (state): PersistedSession => ({ refreshToken: state.refreshToken }),
      storage: createLegacyAwareStorage<PersistedSession>({
        version: 1,
        legacy: { key: SESSION_STORAGE_KEY, read: readLegacyRefresh },
      }),
    },
  ),
)
