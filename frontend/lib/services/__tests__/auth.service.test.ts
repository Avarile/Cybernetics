import { describe, it, expect, beforeEach } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/lib/http/api-client'
import { authService } from '@/lib/services/auth.service'

const mock = new MockAdapter(apiClient)
beforeEach(() => mock.reset())

describe('authService', () => {
  it('login posts credentials and returns the token pair', async () => {
    mock.onPost('/auth/login').reply(200, { accessToken: 'a', refreshToken: 'r', expiresIn: 900 })
    const pair = await authService.login({ email: 'a@b.com', password: 'pw' })
    expect(pair.accessToken).toBe('a')
  })
  it('getMe returns the current user', async () => {
    mock.onGet('/auth/me').reply(200, { id: 'u1', role: 'admin' })
    expect(await authService.getMe()).toEqual({ id: 'u1', role: 'admin' })
  })
  it('getSessions returns the session list', async () => {
    mock.onGet('/auth/sessions').reply(200, [{ id: 's1', createdAt: 't', lastUsedAt: null, expiresAt: 't', userAgent: null, ip: null }])
    expect(await authService.getSessions()).toHaveLength(1)
  })
  it('changePassword PATCHes the password endpoint', async () => {
    mock.onPatch('/auth/password').reply(204)
    await expect(authService.changePassword('old', 'newnewnewnew')).resolves.toBeUndefined()
  })
})
