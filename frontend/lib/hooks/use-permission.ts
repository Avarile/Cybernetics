import { useAuthStore } from '@/lib/state-management/auth.store'
import type { Role } from '@/lib/interfaces/auth.interface'

export function useHasRole(role: Role): boolean {
  return useAuthStore((s) => s.user?.role === role)
}

export function useHasAnyRole(roles: Role[]): boolean {
  return useAuthStore((s) => (s.user ? roles.includes(s.user.role) : false))
}

export function useIsAdmin(): boolean {
  return useHasRole('admin')
}
