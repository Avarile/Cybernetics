import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/services/auth.service', () => ({
  authService: {
    login: vi.fn(),
    getMe: vi.fn(),
    logout: vi.fn(),
  },
}))
vi.mock('@/lib/auth/session', () => ({
  applyTokenPair: vi.fn(),
  clearSession: vi.fn(),
  getRefreshToken: vi.fn(),
  refreshSession: vi.fn(),
}))

import { useAuthStore } from '@/lib/state-management/auth.store'
import { authService } from '@/lib/services/auth.service'
import { applyTokenPair, getRefreshToken, refreshSession } from '@/lib/auth/session'

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: null, status: 'idle', isLoading: false, error: null })
})

describe('auth.store', () => {
  it('login stores the token pair and hydrates the user', async () => {
    vi.mocked(authService.login).mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 })
    vi.mocked(authService.getMe).mockResolvedValue({ id: 'u1', role: 'user' })

    await useAuthStore.getState().login({ email: 'a@b.com', password: 'pw' })

    expect(applyTokenPair).toHaveBeenCalledWith({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 })
    expect(useAuthStore.getState().user).toEqual({ id: 'u1', role: 'user' })
    expect(useAuthStore.getState().status).toBe('authenticated')
  })

  it('bootstrap with no refresh token → unauthenticated', async () => {
    vi.mocked(getRefreshToken).mockReturnValue(undefined)
    await useAuthStore.getState().bootstrap()
    expect(useAuthStore.getState().status).toBe('unauthenticated')
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('bootstrap with a refresh token refreshes then loads the user', async () => {
    vi.mocked(getRefreshToken).mockReturnValue('r')
    vi.mocked(refreshSession).mockResolvedValue({ accessToken: 'a', refreshToken: 'r2', expiresIn: 900 })
    vi.mocked(authService.getMe).mockResolvedValue({ id: 'u1', role: 'admin' })
    await useAuthStore.getState().bootstrap()
    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(useAuthStore.getState().user?.role).toBe('admin')
  })
})
