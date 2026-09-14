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
 * There are THREE spellings of "the rows" across this API, and pretending
 * otherwise has cost a bug per spelling:
 *
 * - `data` — contacts, knowledge, projects, tasks, time, notifications,
 *   invoices, transactions, users, tags, activity, comments, and the rest.
 * - `items` — `/files` alone, which declares its own local `Paginated<T>`.
 *   Verified against a live response: the table reported "49 rows" from
 *   `total` while rendering the empty state, because `data` was undefined.
 * - `rows` — `/finance/budgets`, which returns the repository's
 *   `{ rows, total }` straight through `budget.service.list` with no
 *   page/limit echoed at all.
 *
 * `page` and `limit` are optional for that third case. Safe because no
 * consumer reads them back: `useDomainTable` holds the page it asked for and
 * uses only `total` and `rowsOf()`.
 *
 * This papers over a backend inconsistency. Hoisting one shared `Paginated<T>`
 * on the API side is the real fix, and is a change nobody has approved.
 */
export interface Paginated<T> {
  data?: T[]
  /** file-processor's spelling of `data`. */
  items?: T[]
  /** finance's listBudgets spelling. */
  rows?: T[]
  total: number
  page?: number
  limit?: number
  /**
   * Knowledge only: the count BEFORE per-row access filtering.
   *
   * `knowledge.service.list` pages in SQL, then drops rows the principal
   * cannot see, so `total` is the visible count and a page can come back
   * short. Surfaced rather than hidden — see the footnote the table renders.
   */
  totalBeforeAccess?: number
}

/** The rows from a list envelope, whichever key this endpoint used. */
export function rowsOf<T>(page: Paginated<T> | null | undefined): T[] {
  return page?.data ?? page?.items ?? page?.rows ?? []
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
