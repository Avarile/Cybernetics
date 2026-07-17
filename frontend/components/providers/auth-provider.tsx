'use client'

import { useEffect, useRef } from 'react'
import Cookies from 'js-cookie'
import { useAuthStore } from '@/lib/state-management/auth.store'
import { getSession } from '@/lib/sessionControl'

/**
 * Mounts at the root layout and hydrates the auth store on page load.
 *
 * On every client mount it reads the `session_token` cookie (written by the
 * local login flow or by the /auth/callback route handler after Google OAuth).
 * If present, it restores the in-memory token and fetches the current user +
 * RBAC in parallel. A 401 response automatically clears everything.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Guard against React 19 Strict Mode's double-effect invocation
  const hydrated = useRef(false)
  const fetchCurrentUser = useAuthStore((s) => s.fetchCurrentUser)
  const fetchRbac = useAuthStore((s) => s.fetchRbac)
  const setSessionToken = useAuthStore((s) => s.setSessionToken)

  useEffect(() => {
    if (hydrated.current) return
    hydrated.current = true

    const token = Cookies.get('session_token') ?? getSession()
    if (!token) return

    // Restore in-memory token so apiRequest can inject the Authorization header
    setSessionToken(token)

    // Hydrate user and RBAC concurrently; fetchCurrentUser handles 401 cleanup
    Promise.all([fetchCurrentUser(), fetchRbac()]).catch(() => {})
  }, [fetchCurrentUser, fetchRbac, setSessionToken])

  return <>{children}</>
}
