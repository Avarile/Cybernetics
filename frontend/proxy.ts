import { type NextRequest, NextResponse } from 'next/server'

// ─── Route classification ─────────────────────────────────────────────────────

/** Routes that require an authenticated session. */
const PROTECTED_PREFIXES = ['/dashboard', '/data-links', '/home-page']

/** Routes only accessible when NOT authenticated (redirect away if logged in). */
const AUTH_ONLY_PREFIXES = ['/auth/login', '/auth/signup']

/** Routes that redirect based on auth status: authenticated → /dashboard, guest → /login. */
const ROOT_ROUTES = ['/']

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

function isAuthOnly(pathname: string): boolean {
  return AUTH_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

// ─── Proxy (formerly middleware) ──────────────────────────────────────────────
// Renamed from middleware() to proxy() as of Next.js v16.0.0.
// Docs: https://nextjs.org/docs/app/api-reference/file-conventions/proxy

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Edge Runtime can read both regular and httpOnly cookies
  const sessionToken =
    request.cookies.get('session_token')?.value ??
    request.cookies.get('token')?.value

  const hasSession = Boolean(sessionToken)

  // Root route: authenticated → /dashboard, guest → /login
  if (ROOT_ROUTES.includes(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = hasSession ? '/dashboard/statistics' : '/auth/login'
    return NextResponse.redirect(url)
  }

  // Unauthenticated user hitting a protected route → /login with callbackUrl
  if (isProtected(pathname) && !hasSession) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    url.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(url)
  }

  // Authenticated user hitting a login/signup page → /dashboard
  if (isAuthOnly(pathname) && hasSession) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.searchParams.delete('callbackUrl')
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Run on all paths except:
     *   - _next/static  (static assets)
     *   - _next/image   (image optimisation)
     *   - favicon.ico
     *   - Static file extensions (images, fonts, etc.)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|ico)$).*)',
  ],
}
