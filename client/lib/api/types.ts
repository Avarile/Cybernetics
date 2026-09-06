/** Mirrors `api/src/features/auth/auth.types.ts`. */
export type PrincipalKind = "user" | "service" | "system"
export type UserRole = "user" | "admin" | "agent"

export interface UserProfile {
  id: string | null
  kind: PrincipalKind
  role?: UserRole
  email?: string
  displayName?: string | null
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  /** Access-token lifetime, in seconds. */
  expiresIn: number
}

/**
 * The list envelope every paginated endpoint returns — see e.g.
 * `contact.service.ts#list` and `conversation.service.ts#listForOwner`.
 */
export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  limit: number
}

/**
 * Password rules enforced by the backend zod schemas
 * (`reset-password.dto.ts`, `change-password.dto.ts`). Mirrored so forms can
 * fail fast instead of round-tripping to a 422.
 */
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 200
/** `reset-password.dto.ts` requires exactly six digits. */
export const RESET_CODE_PATTERN = /^\d{6}$/
