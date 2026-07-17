export type Role = 'guest' | 'user' | 'admin' | 'agent'
export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated'

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

/** GET /auth/me → the acting user's profile. `email`/`displayName` are absent for
 *  non-user callers (e.g. service credentials), which have no users row. */
export interface CurrentUser {
  id: string
  role: Role
  email?: string
  displayName?: string | null
}

/** GET /auth/sessions → SessionSummary[] */
export interface SessionSummary {
  id: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string
  userAgent: string | null
  ip: string | null
}

export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  limit: number
}

export interface ErrorEnvelope {
  error: {
    code: string
    message: string
    statusCode: number
    details: unknown | null
    correlationId: string
    timestamp: string
    path: string
  }
}

export interface ILoginInput {
  email: string
  password: string
}

export interface IResetPasswordInput {
  email: string
  code: string
  newPassword: string
}

export interface IAuthState {
  user: CurrentUser | null
  status: AuthStatus
  isLoading: boolean
  error: string | null

  login: (input: ILoginInput) => Promise<void>
  logout: () => Promise<void>
  logoutAll: () => Promise<void>
  bootstrap: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  forgotPassword: (email: string) => Promise<void>
  resetPassword: (input: IResetPasswordInput) => Promise<void>
  clearError: () => void
}
