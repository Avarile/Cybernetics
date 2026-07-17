import { useAuthStore } from '@/lib/state-management/auth.store'
import type { RoleName } from '@/lib/interfaces/auth.interface'

const ROLE_HIERARCHY: RoleName[] = ['guest', 'member', 'operator', 'admin', 'superadmin']

/** Returns true if the current user has the exact named role. */
export function useHasRole(role: RoleName): boolean {
  const roles = useAuthStore((s) => s.roles)
  return roles.some((r) => r.name === role)
}

/** Returns true if the current user has the given permission (action + subject). */
export function useHasPermission(action: string, subject: string): boolean {
  const permissions = useAuthStore((s) => s.permissions)
  return permissions.some((p) => p.action === action && p.subject === subject)
}

/** Returns true if the current user has at least the specified role level. */
export function useHasMinimumRole(minRole: RoleName): boolean {
  const roles = useAuthStore((s) => s.roles)
  const minIndex = ROLE_HIERARCHY.indexOf(minRole)
  return roles.some((r) => ROLE_HIERARCHY.indexOf(r.name) >= minIndex)
}
