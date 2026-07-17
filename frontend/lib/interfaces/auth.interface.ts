export type RoleName = 'guest' | 'member' | 'operator' | 'admin' | 'superadmin'

export interface IRole {
  id: string
  name: RoleName
  description?: string
}

export interface IPermission {
  id: string
  action: string
  subject: string
  conditions?: Record<string, unknown>
}

export interface IUser {
  id: string
  email: string
  userName: string
  firstName?: string | null
  lastName?: string | null
  nickName?: string | null
  title?: string | null
  mobile?: string | null
  position?: string | null
  createdAt: string
  updatedAt: string
  avatar?: string
}

export interface IUpdateProfileInput {
  userName?: string
  firstName?: string | null
  lastName?: string | null
  nickName?: string | null
  title?: string | null
  mobile?: string | null
  position?: string | null
}

export interface IRbacData {
  roles: IRole[]
  permissions: IPermission[]
}

export interface ILoginInput {
  email: string
  password: string
}

export interface IRegisterInput {
  email: string
  userName: string
  password: string
  confirmPassword: string
}

export interface IApiResponse<T = unknown> {
  data: T
  message?: string
  statusCode?: number
}

export interface IApiError {
  message: string | string[]
  error?: string
  statusCode: number
}

export interface IAuthState {
  // Data
  user: IUser | null
  roles: IRole[]
  permissions: IPermission[]
  sessionToken: string | null
  // Status
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  // Actions
  login: (input: ILoginInput) => Promise<void>
  register: (input: IRegisterInput) => Promise<{ email: string }>
  logout: () => Promise<void>
  fetchCurrentUser: () => Promise<void>
  fetchRbac: () => Promise<void>
  updateProfile: (data: IUpdateProfileInput) => Promise<void>
  updatePassword: (currentPassword: string, newPassword: string) => Promise<void>
  verifyEmail: (token: string) => Promise<void>
  resendVerification: (email: string) => Promise<void>
  forgotPassword: (email: string) => Promise<void>
  resetPassword: (token: string, newPassword: string) => Promise<void>
  clearError: () => void
  setSessionToken: (token: string | null) => void
}
