import type { WindowInstance } from "@/lib/windows/types"

/** The schema version the pre-persist window payload was written with. */
const LEGACY_WINDOW_VERSION = 1

/**
 * Reads the pre-persist `cyb.refresh` payload: a bare token string.
 *
 * A persist envelope is refused explicitly. Without that guard, a future read of
 * the new key through this converter would treat the whole envelope as a token
 * and hand the API a credential that can never work.
 */
export function readLegacyRefresh(raw: string | null): { refreshToken: string } | null {
  if (!raw) return null
  const token = raw.trim()
  if (!token || token.startsWith("{")) return null
  return { refreshToken: token }
}

/**
 * Reads the pre-persist `cyb.windows` payload: `{ version, windows }`.
 *
 * Validation is injected rather than imported so this stays pure and so the
 * registry-membership check lives with the registry. A window whose kind is no
 * longer registered is dropped, not restored into a layer that renders nothing
 * for it — the same rule the old `isRestorable` enforced.
 */
export function readLegacyWindows(
  raw: string | null,
  isRestorable: (w: unknown) => boolean,
): { windows: WindowInstance[]; zSeq: number } | null {
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== "object" || parsed === null) return null
  const envelope = parsed as { version?: unknown; windows?: unknown }
  if (envelope.version !== LEGACY_WINDOW_VERSION) return null
  if (!Array.isArray(envelope.windows)) return null

  const windows = envelope.windows.filter(isRestorable) as WindowInstance[]
  return { windows, zSeq: windows.reduce((max, w) => Math.max(max, w.zIndex), 0) }
}
