import axios from 'axios'
import Cookies from 'js-cookie'
import { clientEnv } from '@/lib/config/env'
import { REFRESH_COOKIE, REFRESH_COOKIE_MAX_AGE_DAYS } from '@/lib/config/constants'
import { setAccessToken } from '@/lib/http/token-store'
import type { TokenPair } from '@/lib/interfaces/auth.interface'

// Raw axios instance — deliberately NOT the intercepted api-client, so refresh
// can never recurse through the 401 interceptor.
export const refreshClient = axios.create({
  baseURL: clientEnv.apiUrl,
  headers: { 'Content-Type': 'application/json' },
})

export function getRefreshToken(): string | undefined {
  return Cookies.get(REFRESH_COOKIE)
}

function setRefreshCookie(token: string): void {
  Cookies.set(REFRESH_COOKIE, token, {
    expires: REFRESH_COOKIE_MAX_AGE_DAYS,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
}

export function applyTokenPair(pair: TokenPair): void {
  setAccessToken(pair.accessToken)
  setRefreshCookie(pair.refreshToken)
}

export function clearSession(): void {
  setAccessToken(null)
  Cookies.remove(REFRESH_COOKIE, { path: '/' })
}

export async function refreshSession(): Promise<TokenPair> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) throw new Error('No refresh token')
  const res = await refreshClient.post<TokenPair>('/auth/refresh', { refreshToken })
  applyTokenPair(res.data)
  return res.data
}
