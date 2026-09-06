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

  /** Only a real persist envelope carries `state`. */
  function isEnvelope(text: string): boolean {
    try {
      const parsed = JSON.parse(text)
      return parsed !== null && typeof parsed === "object" && "state" in parsed
    } catch {
      return false
    }
  }

  return {
    getItem: (name) => {
      const existing = raw(name)
      // The legacy and envelope keys are deliberately the same string for some
      // callers (e.g. `cyb.windows`), and a legacy payload can itself be valid
      // JSON — so parsing without error is not proof of a real envelope. Only
      // a real envelope carries `state`; anything else falls through to the
      // legacy path below rather than being handed to `persist` as-is, which
      // would silently discard the legacy data (its `state` reads as
      // `undefined` and the default `merge` just keeps current state).
      if (existing && isEnvelope(existing)) {
        return JSON.parse(existing) as StorageValue<P>
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
      //
      // And ONLY when it differs from the envelope key: some callers (e.g.
      // `cyb.windows`) deliberately reuse the same string for both, so the
      // write above already retired the legacy payload by overwriting it —
      // removing "the legacy key" here would delete the envelope it just wrote.
      if (write(name, value) && options.legacy.key !== name) {
        try {
          localStorage.removeItem(options.legacy.key)
        } catch {
          /* see write() */
        }
      }
      return value
    },

    setItem: (name, value) => {
      // Never clobber a legacy payload that has not been upgraded yet.
      // `skipHydration` means a store can be MUTATED before its first
      // `getItem` — e.g. the auth gate opens on mount long before anything
      // calls `rehydrate()` — and for a same-key caller like `cyb.windows`
      // that write would replace the user's only copy of their layout with
      // an empty envelope, permanently.
      //
      // The refusal has a cost, currently unreachable but worth naming: the
      // session store reuses one key too (`cyb.refresh`), so an early write
      // there would be dropped while the slot still held a convertible legacy
      // token, and that user's session would stop persisting for the rest of
      // the page's life. It self-heals on the next load, because `getItem`
      // runs first and converts. Nothing writes to the session store before
      // `useStateHydration` runs, which is the only reason this cannot fire —
      // so anything that adds an earlier write must move that write after
      // rehydration, not relax the guard.
      if (options.legacy?.key === name) {
        const existing = raw(name)
        // Only protect data the converter can still USE. A slot holding
        // something neither envelope nor convertible (truncated write, unknown
        // version, hand-edited) has nothing worth saving, and refusing to
        // overwrite it would wedge persistence for that user permanently.
        if (existing && !isEnvelope(existing) && options.legacy.read(existing) !== null) return
      }
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
