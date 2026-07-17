import { apiClient } from '@/lib/http/api-client'
import type {
  IApiResponse,
  ILoginInput,
  IRegisterInput,
  IUpdateProfileInput,
  IRbacData,
  IUser,
} from '@/lib/interfaces/auth.interface'

export const authService = {
  login(input: ILoginInput): Promise<IApiResponse<string>> {
    return apiClient
      .post<IApiResponse<string>>('/auth/login/local', {
        email: input.email,
        password: input.password,
      })
      .then((r) => r.data)
  },

  register(input: IRegisterInput): Promise<IApiResponse<IUser>> {
    return apiClient
      .post<IApiResponse<IUser>>('/auth/register/local', {
        email: input.email,
        userName: input.userName,
        password: input.password,
        // confirmPassword intentionally excluded — backend derives it
      })
      .then((r) => r.data)
  },

  logout(): Promise<IApiResponse<void>> {
    return apiClient.post<IApiResponse<void>>('/auth/logout').then((r) => r.data)
  },

  getCurrentUser(): Promise<IApiResponse<IUser>> {
    return apiClient.get<IApiResponse<IUser>>('/current-user/get').then((r) => r.data)
  },

  getRbac(): Promise<IApiResponse<IRbacData>> {
    return apiClient.get<IApiResponse<IRbacData>>('/current-user/rbac').then((r) => r.data)
  },

  updateProfile(data: IUpdateProfileInput): Promise<IApiResponse<IUser>> {
    return apiClient
      .post<IApiResponse<IUser>>('/current-user/update', data)
      .then((r) => r.data)
  },

  updatePassword(currentPassword: string, newPassword: string): Promise<IApiResponse<void>> {
    return apiClient
      .post<IApiResponse<void>>('/current-user/update-password', { currentPassword, newPassword })
      .then((r) => r.data)
  },

  verifyEmail(token: string): Promise<IApiResponse<void>> {
    return apiClient
      .post<IApiResponse<void>>('/auth/verify-email', { token })
      .then((r) => r.data)
  },

  resendVerification(email: string): Promise<IApiResponse<void>> {
    return apiClient
      .post<IApiResponse<void>>('/auth/resend-verification', { email })
      .then((r) => r.data)
  },

  forgotPassword(email: string): Promise<IApiResponse<void>> {
    return apiClient
      .post<IApiResponse<void>>('/auth/forgot-password', { email })
      .then((r) => r.data)
  },

  resetPassword(token: string, newPassword: string): Promise<IApiResponse<void>> {
    return apiClient
      .post<IApiResponse<void>>('/auth/reset-password', { token, newPassword })
      .then((r) => r.data)
  },
}
