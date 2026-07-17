'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import Cookies from 'js-cookie'
import { ApiError, setApiToken } from '@/lib/http/api-client'
import { authService } from '@/lib/services/auth.service'
import { saveSession, clearSession } from '@/lib/sessionControl'
import type {
  IAuthState,
  ILoginInput,
  IRegisterInput,
  IUpdateProfileInput,
  IUser,
} from '@/lib/interfaces/auth.interface'

// ─── Eager token hydration ────────────────────────────────────────────────────
// This runs synchronously when the module is first imported — before any React
// component mounts or any useEffect fires. It ensures _sessionToken in
// api-client is populated from the cookie so that the very first API call on a
// page load (e.g. fetchAll in a dashboard page's useEffect) already carries a
// valid bearer token without waiting for AuthProvider to run.

if (typeof window !== 'undefined') {
  const earlyToken = Cookies.get('session_token')
  if (earlyToken) setApiToken(earlyToken)
}

// ─── Cookie config ────────────────────────────────────────────────────────────

const COOKIE_NAME = 'session_token'

function writeCookie(token: string): void {
  Cookies.set(COOKIE_NAME, token, {
    expires: 1, // 1 day — matches backend SESSION_EXPIRE (86400s)
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
}

function clearCookie(): void {
  Cookies.remove(COOKIE_NAME, { path: '/' })
}

// ─── Initial state (reused on logout) ────────────────────────────────────────

const INITIAL_STATE = {
  user: null,
  roles: [],
  permissions: [],
  sessionToken: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
}

// ─── Store creator ────────────────────────────────────────────────────────────
// Using StateCreator<T, Mutators, [], T> as required by Zustand v5 + TypeScript
// when composing with devtools middleware.

const authStoreCreator: StateCreator<
  IAuthState,
  [['zustand/devtools', never]],
  [],
  IAuthState
> = (set, get) => ({
  ...INITIAL_STATE,

  setSessionToken: (token) => {
    set({ sessionToken: token }, false, 'auth/setSessionToken')
    setApiToken(token)
  },

  clearError: () => set({ error: null }, false, 'auth/clearError'),

  login: async (input: ILoginInput) => {
    set({ isLoading: true, error: null }, false, 'auth/login/pending')
    try {
      const res = await authService.login(input)
      const token = res.data // "session:uuid4"

      // Write the session token to every storage layer first.
      // fetchCurrentUser/fetchRbac are intentionally NOT called here.
      // AuthProvider handles hydration on every page mount, so the caller
      // can redirect immediately after this resolves without the cookie
      // being nuked by a premature 401 from the hydration calls.
      writeCookie(token)
      saveSession(token)
      get().setSessionToken(token)
      set({ isAuthenticated: true, isLoading: false }, false, 'auth/login/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Login failed'
      set({ error: message, isLoading: false }, false, 'auth/login/rejected')
      throw err
    }
  },

  register: async (input: IRegisterInput) => {
    set({ isLoading: true, error: null }, false, 'auth/register/pending')
    try {
      await authService.register(input)
      set({ isLoading: false }, false, 'auth/register/fulfilled')
      return { email: input.email }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Registration failed'
      set({ error: message, isLoading: false }, false, 'auth/register/rejected')
      throw err
    }
  },

  logout: async () => {
    set({ isLoading: true }, false, 'auth/logout/pending')
    try {
      await authService.logout()
    } catch {
      // Continue with local cleanup even if server call fails
    } finally {
      clearCookie()
      clearSession()
      get().setSessionToken(null)
      set({ ...INITIAL_STATE }, false, 'auth/logout/fulfilled')
    }
  },

  fetchCurrentUser: async () => {
    try {
      const res = await authService.getCurrentUser()
      set({ user: res.data, isAuthenticated: true }, false, 'auth/fetchCurrentUser/fulfilled')
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        // Clear the in-memory token so future API calls stop sending the
        // invalid bearer header, but intentionally keep the cookie intact.
        // The proxy reads the cookie for every hard navigation — nuking it
        // here would silently break all subsequent page transitions (e.g.
        // clicking a Close → /dashboard button) even while the user is still
        // actively using the app. Session expiry is the backend's concern;
        // the cookie's own 1-day TTL handles client-side cleanup.
        get().setSessionToken(null)
        set(
          { user: null, isAuthenticated: false, roles: [], permissions: [] },
          false,
          'auth/fetchCurrentUser/expired',
        )
      }
    }
  },

  fetchRbac: async () => {
    try {
      const res = await authService.getRbac()
      set(
        { roles: res.data.roles, permissions: res.data.permissions },
        false,
        'auth/fetchRbac/fulfilled',
      )
    } catch {
      // Non-fatal: RBAC unavailability does not invalidate the session
    }
  },

  verifyEmail: async (token: string) => {
    set({ isLoading: true, error: null }, false, 'auth/verifyEmail/pending')
    try {
      await authService.verifyEmail(token)
      set({ isLoading: false }, false, 'auth/verifyEmail/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Verification failed'
      set({ error: message, isLoading: false }, false, 'auth/verifyEmail/rejected')
      throw err
    }
  },

  resendVerification: async (email: string) => {
    set({ isLoading: true, error: null }, false, 'auth/resendVerification/pending')
    try {
      await authService.resendVerification(email)
      set({ isLoading: false }, false, 'auth/resendVerification/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Resend failed'
      set({ error: message, isLoading: false }, false, 'auth/resendVerification/rejected')
      throw err
    }
  },

  forgotPassword: async (email: string) => {
    set({ isLoading: true, error: null }, false, 'auth/forgotPassword/pending')
    try {
      await authService.forgotPassword(email)
      set({ isLoading: false }, false, 'auth/forgotPassword/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Request failed'
      set({ error: message, isLoading: false }, false, 'auth/forgotPassword/rejected')
      throw err
    }
  },

  resetPassword: async (token: string, newPassword: string) => {
    set({ isLoading: true, error: null }, false, 'auth/resetPassword/pending')
    try {
      await authService.resetPassword(token, newPassword)
      set({ isLoading: false }, false, 'auth/resetPassword/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Password reset failed'
      set({ error: message, isLoading: false }, false, 'auth/resetPassword/rejected')
      throw err
    }
  },

  updateProfile: async (data: IUpdateProfileInput) => {
    set({ isLoading: true, error: null }, false, 'auth/updateProfile/pending')
    try {
      const res = await authService.updateProfile(data)
      set({ user: res.data, isLoading: false }, false, 'auth/updateProfile/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Update failed'
      set({ error: message, isLoading: false }, false, 'auth/updateProfile/rejected')
      throw err
    }
  },

  updatePassword: async (currentPassword: string, newPassword: string) => {
    set({ isLoading: true, error: null }, false, 'auth/updatePassword/pending')
    try {
      await authService.updatePassword(currentPassword, newPassword)
      set({ isLoading: false }, false, 'auth/updatePassword/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Password update failed'
      set({ error: message, isLoading: false }, false, 'auth/updatePassword/rejected')
      throw err
    }
  },
})

// ─── Store ────────────────────────────────────────────────────────────────────
// create<T>()() currying is required for TypeScript generics + middleware.
// devtools is no-op in production (process.env.NODE_ENV !== 'development').

export const useAuthStore = create<IAuthState>()(
  devtools(authStoreCreator, {
    name: 'AuthStore',
    enabled: process.env.NODE_ENV === 'development',
  }),
)

// ─── Selector hooks ───────────────────────────────────────────────────────────

export const useUser = () => useAuthStore((s) => s.user)
export const useIsAuthenticated = () => useAuthStore((s) => s.isAuthenticated)
export const useRoles = () => useAuthStore((s) => s.roles)
export const usePermissions = () => useAuthStore((s) => s.permissions)
export const useAuthLoading = () => useAuthStore((s) => s.isLoading)
export const useAuthError = () => useAuthStore((s) => s.error)
