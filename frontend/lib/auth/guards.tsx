'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore, useUserRole } from '@/lib/state-management/auth.store'
import { LOGIN_PATH, DEFAULT_AUTHED_PATH } from '@/lib/auth/route-policy'
import type { Role } from '@/lib/interfaces/auth.interface'

export function useRequireAuth(): { ready: boolean } {
  const status = useAuthStore((s) => s.status)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (status === 'unauthenticated') {
      const url = `${LOGIN_PATH}?callbackUrl=${encodeURIComponent(pathname)}`
      router.replace(url)
    }
  }, [status, router, pathname])

  return { ready: status === 'authenticated' }
}

export function useRequireRole(role: Role): { ready: boolean; allowed: boolean } {
  const { ready } = useRequireAuth()
  const currentRole = useUserRole()
  const router = useRouter()
  const allowed = currentRole === role

  useEffect(() => {
    if (ready && !allowed) router.replace(DEFAULT_AUTHED_PATH)
  }, [ready, allowed, router])

  return { ready: ready && allowed, allowed }
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { ready } = useRequireAuth()
  if (!ready) return null
  return <>{children}</>
}

export function RoleGuard({ role, children }: { role: Role; children: React.ReactNode }) {
  const { ready } = useRequireRole(role)
  if (!ready) return null
  return <>{children}</>
}
