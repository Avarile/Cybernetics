import axios, { type AxiosInstance, type AxiosError } from 'axios'
import type { IApiError } from '@/lib/interfaces/auth.interface'

// ─── Error class ──────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly raw?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// ─── Env guard ────────────────────────────────────────────────────────────────
// Runs once at module load time (both server and client bundles).
// Throws during build / startup so a missing variable is caught immediately
// rather than surfacing as a cryptic network error at runtime.

const API_URL = process.env.NEXT_PUBLIC_API_URL

if (!API_URL) {
  throw new Error(
    '[api-client] NEXT_PUBLIC_API_URL is not set.\n' +
    'Add it to your .env.local (or deployment environment) and restart the dev server.\n' +
    'Example: NEXT_PUBLIC_API_URL=http://localhost:3001',
  )
}

// ─── In-memory token ──────────────────────────────────────────────────────────
// Set by the auth store after login / logout.
// The request interceptor injects it as Authorization: Bearer <token>.
// Google OAuth sessions rely on the httpOnly cookie sent automatically via
// withCredentials: true, so this may be null for those sessions.

// Read the session cookie synchronously so the very first API call on any
// page load already carries a bearer token, even before AuthProvider runs.
function readCookieSync(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

let _sessionToken: string | null = readCookieSync('session_token')

export function setApiToken(token: string | null): void {
  _sessionToken = token
}

// ─── Axios instance ───────────────────────────────────────────────────────────

export const apiClient: AxiosInstance = axios.create({
  baseURL: `${API_URL}/api`,
  withCredentials: true, // send cookies (OAuth httpOnly session) on every request
  headers: { 'Content-Type': 'application/json' },
})

// ─── Request interceptor — inject bearer token ────────────────────────────────
// Prefer the in-memory token (set by setApiToken after login / early hydration).
// Fall back to reading the cookie directly at request time so that the header
// is still injected even when the module was first evaluated during SSR (where
// document is undefined and _sessionToken starts as null).

apiClient.interceptors.request.use((config) => {
  const token = _sessionToken ?? readCookieSync('session_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
    // Keep the in-memory token in sync so subsequent calls skip the cookie read.
    if (!_sessionToken) _sessionToken = token
  }
  return config
})

// ─── Response interceptor — normalize shape ────────────────────────────────────
// The backend ResponseInterceptor wraps every success as:
//   { status: 'success', payload: <data>, message, count, pagination, ... }
// The frontend services expect:
//   { data: <data>, message, count, pagination }
// This interceptor flattens the backend envelope so services work uniformly.

apiClient.interceptors.response.use(
  (response) => {
    const body = response.data
    if (body && body.status === 'success' && 'payload' in body) {
      response.data = {
        data: body.payload,
        message: body.message,
        count: body.count,
        pagination: body.pagination,
      }
    }
    return response
  },
  (error: AxiosError<IApiError>) => {
    const data = error.response?.data
    const rawMessage = data?.message
    const message = Array.isArray(rawMessage)
      ? rawMessage.join(', ')
      : (rawMessage ?? error.message ?? 'Unknown error')
    const statusCode = error.response?.status ?? 0
    return Promise.reject(new ApiError(message, statusCode, data))
  },
)
