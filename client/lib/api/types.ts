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
 * The list envelope paginated endpoints return.
 *
 * The rows arrive under `data` from ten of the eleven paginated services
 * (contacts, knowledge, projects, notifications, tags, activity, comments,
 * schedules, system-settings, integration-credentials) — but under `items`
 * from `file-processor`, which declares its own local `Paginated<T>` with that
 * key. Verified against a live `/files` response: the table reported "49 rows"
 * from `total` while rendering the empty state, because `data` was undefined.
 *
 * Both are accepted here rather than pretending the API is uniform. See
 * `rowsOf()`.
 */
export interface Paginated<T> {
  data?: T[]
  /** file-processor's spelling of `data`. */
  items?: T[]
  total: number
  page: number
  limit: number
}

/** The rows from a list envelope, whichever key this endpoint used. */
export function rowsOf<T>(page: Paginated<T> | null | undefined): T[] {
  return page?.data ?? page?.items ?? []
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
