import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

/**
 * Google OAuth callback bridge.
 *
 * After the backend completes Google OAuth it redirects here with the session
 * already established as an httpOnly cookie.  Because httpOnly cookies are
 * inaccessible to client-side JavaScript, this route handler:
 *   1. Reads the httpOnly `session_token` from the incoming request
 *   2. Verifies it against the backend
 *   3. Re-sets the same value as a readable (non-httpOnly) cookie so the
 *      client-side AuthProvider can pick it up and hydrate the Zustand store
 *   4. Redirects to /dashboard on success, /login on failure
 */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get('session_token')?.value

  if (!sessionToken) {
    const url = new URL('', request.url)
    url.searchParams.set('error', 'oauth_failed')
    return NextResponse.redirect(url)
  }

  // Verify the session is still valid by calling the backend server-side
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001'
  try {
    const res = await fetch(`${apiUrl}/api/current-user/get`, {
      headers: { Cookie: `session_token=${sessionToken}` },
    })

    if (!res.ok) throw new Error('Invalid session')
  } catch {
    const url = new URL('/auth/login', request.url)
    url.searchParams.set('error', 'session_invalid')
    return NextResponse.redirect(url)
  }

  // Redirect to dashboard, re-setting the cookie as readable (non-httpOnly)
  const redirectUrl = new URL('/dashboard', request.url)
  const response = NextResponse.redirect(redirectUrl)

  response.cookies.set('session_token', sessionToken, {
    httpOnly: false, // Must be readable by client JS (AuthProvider)
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 86400, // 1 day — matches backend SESSION_EXPIRE
  })

  return response
}
