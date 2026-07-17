import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import { clientEnv } from '@/lib/config/env'
import { ERROR_CODES } from '@/lib/config/constants'
import { getAccessToken } from '@/lib/http/token-store'
import { refreshSession, clearSession } from '@/lib/auth/session'
import type { ErrorEnvelope } from '@/lib/interfaces/auth.interface'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly correlationId?: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** Field-level messages parsed from a VALIDATION_FAILED envelope. path → message. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {}
    const d = this.details as { issues?: { path: string; message: string }[] } | null | undefined
    if (d && Array.isArray(d.issues)) {
      for (const issue of d.issues) {
        const key = issue.path && issue.path !== '(root)' ? issue.path : '_root'
        if (!(key in out)) out[key] = issue.message
      }
    }
    return out
  }
}

// Overridable so the auth store can wire "hard logout + redirect", and tests
// can assert it without touching window.location.
let onUnauthorized: () => void = () => {
  if (typeof window !== 'undefined') window.location.href = '/auth/login'
}
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: clientEnv.apiUrl, // NO /api prefix — backend routes are root-level
  headers: { 'Content-Type': 'application/json' },
})

// ── Request: inject bearer token ────────────────────────────────────────────
apiClient.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Response: normalize errors + single-flight refresh ──────────────────────
function toApiError(error: AxiosError<ErrorEnvelope>): ApiError {
  const env = error.response?.data?.error
  if (env) return new ApiError(env.message, env.code, env.statusCode, env.correlationId, env.details)
  return new ApiError(error.message || 'Network error', 'NETWORK_ERROR', error.response?.status ?? 0)
}

let refreshPromise: Promise<unknown> | null = null

apiClient.interceptors.response.use(
  (r) => r,
  async (error: AxiosError<ErrorEnvelope>) => {
    const apiError = toApiError(error)
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined

    const isExpired = apiError.code === ERROR_CODES.AUTH_TOKEN_EXPIRED
    if (isExpired && original && !original._retry) {
      original._retry = true
      try {
        refreshPromise = refreshPromise ?? refreshSession().finally(() => { refreshPromise = null })
        await refreshPromise
        return apiClient(original) // replay; request interceptor re-adds the fresh bearer
      } catch {
        clearSession()
        onUnauthorized()
        return Promise.reject(apiError)
      }
    }

    // Non-refreshable auth failures → hard logout.
    if (apiError.statusCode === 401 && apiError.code !== ERROR_CODES.AUTH_INVALID_CREDENTIALS) {
      clearSession()
      onUnauthorized()
    }
    return Promise.reject(apiError)
  },
)
