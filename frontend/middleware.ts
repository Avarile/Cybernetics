import { NextResponse, type NextRequest } from 'next/server'
import { REFRESH_COOKIE } from '@/lib/config/constants'
import {
  isAuthRoute, isProtectedRoute, LOGIN_PATH, DEFAULT_AUTHED_PATH,
} from '@/lib/auth/route-policy'

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const hasSession = req.cookies.has(REFRESH_COOKIE)

  // Authenticated users should not sit on auth pages.
  if (hasSession && isAuthRoute(pathname)) {
    return NextResponse.redirect(new URL(DEFAULT_AUTHED_PATH, req.url))
  }

  // Unauthenticated users cannot reach protected pages.
  if (!hasSession && isProtectedRoute(pathname)) {
    const url = new URL(LOGIN_PATH, req.url)
    url.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  // Exclude Next internals, the API-core proxy, and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)'],
}
