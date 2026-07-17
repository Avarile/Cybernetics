import type { CurrentUser } from '@/lib/interfaces/auth.interface'

/** Best available human label: the profile display name, else the email local-part, else a generic fallback. */
export function deriveDisplayName(user: CurrentUser): string {
  const displayName = user.displayName?.trim()
  if (displayName) return displayName
  if (user.email) return user.email.split('@')[0]
  return 'User'
}
