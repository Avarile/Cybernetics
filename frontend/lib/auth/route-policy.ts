export const LOGIN_PATH = '/auth/login'
export const DEFAULT_AUTHED_PATH = '/dashboard'

/** Routes reachable WITHOUT a session (the auth flow). */
export const AUTH_ROUTES = ['/auth/login', '/auth/forgot-password', '/auth/reset-password']

/** Public routes that are neither auth nor protected (e.g. the marketing landing). */
export const PUBLIC_ROUTES = ['/']

/** Admin-only route prefixes (client gate; backend RolesGuard is authoritative). */
export const ADMIN_ROUTES = ['/admin']

const startsWithAny = (pathname: string, prefixes: string[]) =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))

export function isAuthRoute(pathname: string): boolean {
  return startsWithAny(pathname, AUTH_ROUTES)
}

export function isAdminRoute(pathname: string): boolean {
  return startsWithAny(pathname, ADMIN_ROUTES)
}

/** Everything that is not public and not an auth route requires a session. */
export function isProtectedRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.includes(pathname)) return false
  if (isAuthRoute(pathname)) return false
  return true
}
