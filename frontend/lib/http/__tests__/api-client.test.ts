import { describe, it, expect, beforeEach, vi } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import { apiClient, ApiError, setUnauthorizedHandler } from '@/lib/http/api-client'
import { refreshClient, applyTokenPair, clearSession } from '@/lib/auth/session'
import { getAccessToken, setAccessToken } from '@/lib/http/token-store'

const api = new MockAdapter(apiClient)
const refresh = new MockAdapter(refreshClient)

beforeEach(() => {
  api.reset(); refresh.reset(); clearSession(); setAccessToken(null)
  setUnauthorizedHandler(() => {})
})

describe('ApiError mapping', () => {
  it('maps the backend error envelope', async () => {
    api.onGet('/x').reply(400, {
      error: {
        code: 'VALIDATION_FAILED', message: 'bad', statusCode: 400,
        details: { issues: [{ path: 'email', message: 'Invalid' }] },
        correlationId: 'cid', timestamp: 't', path: '/x',
      },
    })
    await expect(apiClient.get('/x')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED', statusCode: 400, correlationId: 'cid',
    })
    try {
      await apiClient.get('/x')
    } catch (e) {
      expect((e as ApiError).fieldErrors).toEqual({ email: 'Invalid' })
    }
  })
})

describe('single-flight refresh on AUTH_TOKEN_EXPIRED', () => {
  it('refreshes once and replays the original request', async () => {
    applyTokenPair({ accessToken: 'expired', refreshToken: 'r', expiresIn: 900 })
    let calls = 0
    api.onGet('/me').reply(() => {
      calls += 1
      if (calls === 1) {
        return [401, { error: { code: 'AUTH_TOKEN_EXPIRED', message: 'x', statusCode: 401, details: null, correlationId: 'c', timestamp: 't', path: '/me' } }]
      }
      return [200, { id: 'u1', role: 'user' }]
    })
    refresh.onPost('/auth/refresh').reply(200, { accessToken: 'fresh', refreshToken: 'r2', expiresIn: 900 })

    const res = await apiClient.get('/me')
    expect(res.data).toEqual({ id: 'u1', role: 'user' })
    expect(getAccessToken()).toBe('fresh')
  })

  it('hard-logs-out when refresh fails', async () => {
    applyTokenPair({ accessToken: 'expired', refreshToken: 'r', expiresIn: 900 })
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    api.onGet('/me').reply(401, { error: { code: 'AUTH_TOKEN_EXPIRED', message: 'x', statusCode: 401, details: null, correlationId: 'c', timestamp: 't', path: '/me' } })
    refresh.onPost('/auth/refresh').reply(401, { error: { code: 'AUTH_TOKEN_REUSE', message: 'x', statusCode: 401, details: null, correlationId: 'c', timestamp: 't', path: '/auth/refresh' } })

    await expect(apiClient.get('/me')).rejects.toBeInstanceOf(ApiError)
    expect(onUnauthorized).toHaveBeenCalled()
    expect(getAccessToken()).toBeNull()
  })
})
