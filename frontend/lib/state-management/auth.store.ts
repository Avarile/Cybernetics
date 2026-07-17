'use client'

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { ApiError, setUnauthorizedHandler } from '@/lib/http/api-client'
import { authService } from '@/lib/services/auth.service'
import {
  applyTokenPair, clearSession, getRefreshToken, refreshSession,
} from '@/lib/auth/session'
import type { IAuthState, IResetPasswordInput, Role } from '@/lib/interfaces/auth.interface'

const INITIAL = {
  user: null,
  status: 'idle' as const,
  isLoading: false,
  error: null,
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

export const useAuthStore = create<IAuthState>()(
  devtools(
    (set, get) => ({
      ...INITIAL,

      clearError: () => set({ error: null }, false, 'auth/clearError'),

      login: async (input) => {
        set({ isLoading: true, error: null }, false, 'auth/login/pending')
        try {
          const pair = await authService.login(input)
          applyTokenPair(pair)
          const user = await authService.getMe()
          set({ user, status: 'authenticated', isLoading: false }, false, 'auth/login/ok')
        } catch (err) {
          set({ error: messageOf(err, 'Login failed'), isLoading: false }, false, 'auth/login/err')
          throw err
        }
      },

      logout: async () => {
        const rt = getRefreshToken()
        try {
          if (rt) await authService.logout(rt)
        } catch {
          // best-effort; continue local cleanup
        } finally {
          clearSession()
          set({ ...INITIAL, status: 'unauthenticated' }, false, 'auth/logout')
        }
      },

      logoutAll: async () => {
        try {
          await authService.logoutAll()
        } finally {
          clearSession()
          set({ ...INITIAL, status: 'unauthenticated' }, false, 'auth/logoutAll')
        }
      },

      bootstrap: async () => {
        if (!getRefreshToken()) {
          set({ status: 'unauthenticated' }, false, 'auth/bootstrap/anon')
          return
        }
        set({ status: 'loading' }, false, 'auth/bootstrap/pending')
        try {
          await refreshSession()
          const user = await authService.getMe()
          set({ user, status: 'authenticated' }, false, 'auth/bootstrap/ok')
        } catch {
          clearSession()
          set({ ...INITIAL, status: 'unauthenticated' }, false, 'auth/bootstrap/fail')
        }
      },

      changePassword: async (currentPassword, newPassword) => {
        set({ isLoading: true, error: null }, false, 'auth/changePassword/pending')
        try {
          await authService.changePassword(currentPassword, newPassword)
          // Backend revokes ALL sessions → force a clean re-login.
          clearSession()
          set({ ...INITIAL, status: 'unauthenticated' }, false, 'auth/changePassword/ok')
        } catch (err) {
          set({ error: messageOf(err, 'Password change failed'), isLoading: false }, false, 'auth/changePassword/err')
          throw err
        }
      },

      forgotPassword: async (email) => {
        set({ isLoading: true, error: null }, false, 'auth/forgotPassword/pending')
        try {
          await authService.forgotPassword(email)
          set({ isLoading: false }, false, 'auth/forgotPassword/ok')
        } catch (err) {
          set({ error: messageOf(err, 'Request failed'), isLoading: false }, false, 'auth/forgotPassword/err')
          throw err
        }
      },

      resetPassword: async (input: IResetPasswordInput) => {
        set({ isLoading: true, error: null }, false, 'auth/resetPassword/pending')
        try {
          await authService.resetPassword(input)
          set({ isLoading: false }, false, 'auth/resetPassword/ok')
        } catch (err) {
          set({ error: messageOf(err, 'Password reset failed'), isLoading: false }, false, 'auth/resetPassword/err')
          throw err
        }
      },
    }),
    { name: 'AuthStore', enabled: process.env.NODE_ENV === 'development' },
  ),
)

// Register the hard-logout handler the api-client calls on unrecoverable 401s.
let wired = false
export function wireAuthUnauthorizedHandler(): void {
  if (wired) return
  wired = true
  setUnauthorizedHandler(() => {
    clearSession()
    useAuthStore.setState({ user: null, status: 'unauthenticated', isLoading: false })
    if (typeof window !== 'undefined') window.location.href = '/auth/login'
  })
}

// ── selectors ───────────────────────────────────────────────────────────────
export const useUser = () => useAuthStore((s) => s.user)
export const useAuthStatus = () => useAuthStore((s) => s.status)
export const useIsAuthenticated = () => useAuthStore((s) => s.status === 'authenticated')
export const useAuthLoading = () => useAuthStore((s) => s.isLoading)
export const useAuthError = () => useAuthStore((s) => s.error)
export const useUserRole = (): Role | undefined => useAuthStore((s) => s.user?.role)
