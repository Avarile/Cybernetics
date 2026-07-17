import type { CurrentUser } from '@/lib/interfaces/auth.interface'

/** Stable label for a user without a display-name field. */
export function deriveDisplayName(user: CurrentUser): string {
  if (user.email) return user.email.split('@')[0]
  return 'User'
}
