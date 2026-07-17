import { apiClient } from '@/lib/http/api-client'
import type {
  CurrentUser, SessionSummary, TokenPair, ILoginInput, IResetPasswordInput,
} from '@/lib/interfaces/auth.interface'

export const authService = {
  login(input: ILoginInput): Promise<TokenPair> {
    return apiClient.post<TokenPair>('/auth/login', input).then((r) => r.data)
  },
  logout(refreshToken: string): Promise<void> {
    return apiClient.post('/auth/logout', { refreshToken }).then(() => undefined)
  },
  logoutAll(): Promise<void> {
    return apiClient.post('/auth/logout-all').then(() => undefined)
  },
  getMe(): Promise<CurrentUser> {
    return apiClient.get<CurrentUser>('/auth/me').then((r) => r.data)
  },
  getSessions(): Promise<SessionSummary[]> {
    return apiClient.get<SessionSummary[]>('/auth/sessions').then((r) => r.data)
  },
  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return apiClient.patch('/auth/password', { currentPassword, newPassword }).then(() => undefined)
  },
  forgotPassword(email: string): Promise<void> {
    return apiClient.post('/auth/forgot-password', { email }).then(() => undefined)
  },
  resetPassword(input: IResetPasswordInput): Promise<void> {
    return apiClient.post('/auth/reset-password', input).then(() => undefined)
  },
}
