import type { Cache } from "swr"

/**
 * A size-bounded wrapper around SWR's cache map.
 *
 * SWR's default provider is a plain `Map` that nothing ever evicts from, so
 * every key a session touches is retained for the life of the tab: one entry
 * per list page, per filter combination, per collection, per lookup and per
 * report. Clicking through seven data domains and their sections is tens of
 * keys a minute, and `useDomainTable` sets `keepPreviousData`, so the entries
 * a page left behind stay populated rather than emptying. Nothing here was
 * individually large; the total simply had no ceiling.
 *
 * Eviction is least-recently-READ, and that choice is what makes it safe.
 * SWR reads through `cache.get` from its `useSyncExternalStore` snapshot, so a
 * mounted hook touches its own key on every render and every revalidation —
 * live keys are always the hottest, and only keys nothing is looking at can
 * fall off the end. A key that does get evicted is not an error either: the
 * hook that asks for it next simply refetches.
 */

/**
 * Generous on purpose. A single table page is one key, its lookups and filters
 * perhaps a dozen; this is hundreds of navigations' worth of history, so the
 * cap is only ever reached by a session that would otherwise have grown without
 * limit. Set low enough to thrash and the cost is refetches, not correctness.
 */
export const DEFAULT_CACHE_LIMIT = 250

/** How far below the cap one eviction pass goes, so it is not re-triggered on
 *  the very next `set`. */
const EVICT_TO = 0.9

export function createBoundedCache<Data>(
  base: Cache<Data>,
  limit: number = DEFAULT_CACHE_LIMIT,
): Cache<Data> {
  // Recency lives beside the cache rather than being expressed as its insertion
  // order. Re-inserting on read would reorder `base`, and `useInvalidate`
  // iterates `keys()` while `mutate` writes back through `set` — reordering
  // mid-iteration is how a key gets visited twice or skipped entirely.
  //
  // It doubles as the size counter: SWR's `Cache` interface is only
  // get/set/delete/keys, with no `size`, and counting `keys()` on every write
  // would make each one O(n). Seeded from whatever the inherited cache already
  // holds, because `provider` is handed the parent's cache, not an empty one.
  const readAt = new Map<string, number>()
  let clock = 0
  for (const key of base.keys()) readAt.set(key, ++clock)

  function evict(): void {
    if (readAt.size <= limit) return
    const target = Math.floor(limit * EVICT_TO)
    // Oldest first. The set being sorted is bounded by `limit` plus the one key
    // that just overflowed it, and this runs only on the `set` that crosses the
    // line — not on every write.
    const byAge = [...readAt.entries()].sort((a, b) => a[1] - b[1])
    for (const [key] of byAge) {
      if (readAt.size <= target) break
      base.delete(key)
      readAt.delete(key)
    }
  }

  return {
    get: (key) => {
      const value = base.get(key)
      // Touch only on a hit. Recording a miss would give a key that holds
      // nothing a recency score, and SWR probes keys it has never written.
      if (value !== undefined) readAt.set(key, ++clock)
      return value
    },

    set: (key, value) => {
      base.set(key, value)
      readAt.set(key, ++clock)
      evict()
    },

    delete: (key) => {
      base.delete(key)
      readAt.delete(key)
    },

    keys: () => base.keys(),
  }
}
