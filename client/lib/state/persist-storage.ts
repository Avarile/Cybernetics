import type { PersistStorage, StorageValue } from "zustand/middleware"

export interface LegacyAwareStorageOptions<P> {
  /** Written into the envelope so `persist`'s own migrate can take over later. */
  version: number
  legacy?: {
    /** The pre-persist localStorage key. */
    key: string
    /** Pure converter from the legacy payload to the persisted slice. */
    read: (raw: string | null) => P | null
  }
}

/**
 * `persist` storage that upgrades a pre-persist payload exactly once.
 *
 * `persist`'s own `migrate` cannot help here: it runs on an envelope it already
 * parsed, and the legacy payloads are not envelopes at all. So the upgrade has
 * to happen a layer lower, on read.
 *
 * Every access is guarded. localStorage throws in private modes and when the
 * quota is exhausted, and losing a restored layout is never worth breaking the
 * session over.
 */
export function createLegacyAwareStorage<P>(
  options: LegacyAwareStorageOptions<P>,
): PersistStorage<P> {
  function raw(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }

  function write(key: string, value: StorageValue<P>): boolean {
    try {
      localStorage.setItem(key, JSON.stringify(value))
      return true
    } catch {
      // Quota, or a privacy mode that refuses writes.
      return false
    }
  }

  return {
    getItem: (name) => {
      const existing = raw(name)
      if (existing) {
        try {
          return JSON.parse(existing) as StorageValue<P>
        } catch {
          // A hand-edited or truncated envelope. Fall through to the legacy
          // path rather than handing `persist` a broken object.
        }
      }

      if (!options.legacy) return null

      const converted = options.legacy.read(raw(options.legacy.key))
      // `=== null`, not falsy: the contract is `P | null`, and a converter may
      // legitimately produce a falsy-but-valid slice.
      if (converted === null) return null

      const value: StorageValue<P> = { state: converted, version: options.version }
      // Retire the legacy key ONLY once its replacement is actually on disk.
      // Deleting it after a swallowed quota failure would destroy the user's
      // one surviving copy of their refresh token and workspace — strictly
      // worse than never upgrading at all.
      if (write(name, value)) {
        try {
          localStorage.removeItem(options.legacy.key)
        } catch {
          /* see write() */
        }
      }
      return value
    },

    setItem: (name, value) => {
      write(name, value)
    },

    removeItem: (name) => {
      try {
        localStorage.removeItem(name)
      } catch {
        /* see write() */
      }
    },
  }
}
