import { describe, expect, it } from "vitest"
import type { Cache, State } from "swr"
import { createBoundedCache } from "./bounded-cache"

/** The default SWR provider: a plain Map, which is what `provider` receives. */
const base = (entries: [string, State<number>][] = []) =>
  new Map<string, State<number>>(entries) as unknown as Cache<number>

/** SWR caches a state envelope per key, not a bare value. */
const v = (data: number): State<number> => ({ data })

describe("createBoundedCache", () => {
  it("reads and writes through to the underlying cache", () => {
    const cache = createBoundedCache(base(), 10)
    cache.set("a", v(1))
    expect(cache.get("a")).toEqual(v(1))
    cache.delete("a")
    expect(cache.get("a")).toBeUndefined()
  })

  it("keeps every key while under the limit", () => {
    const cache = createBoundedCache(base(), 10)
    for (let i = 0; i < 10; i++) cache.set(`k${i}`, v(i))
    expect([...cache.keys()]).toHaveLength(10)
  })

  it("evicts below the limit once it is crossed, rather than one key per write", () => {
    // One pass takes it to 90% of the cap, so the next writes do not each
    // trigger another sort.
    const cache = createBoundedCache(base(), 10)
    for (let i = 0; i < 11; i++) cache.set(`k${i}`, v(i))
    expect([...cache.keys()].length).toBeLessThanOrEqual(9)
  })

  it("evicts the least recently READ key, not the least recently written", () => {
    // The whole safety argument rests on this. SWR reads through `get` from its
    // useSyncExternalStore snapshot, so a mounted hook touches its key on every
    // render; eviction by write order would drop a key something is looking at.
    const cache = createBoundedCache(base(), 4)
    cache.set("old", v(1))
    cache.set("b", v(2))
    cache.set("c", v(3))
    cache.set("d", v(4))

    // "old" is the oldest write, but it is the one being actively read.
    cache.get("old")

    cache.set("e", v(5))

    expect(cache.get("old")).toEqual(v(1))
    expect(cache.get("b")).toBeUndefined()
  })

  it("does not let a read miss occupy the budget", () => {
    // SWR probes keys it has never written. Recording those would spend the cap
    // on entries holding nothing and evict the ones that do.
    const cache = createBoundedCache(base(), 3)
    cache.set("a", v(1))

    for (let i = 0; i < 50; i++) cache.get(`miss${i}`)

    expect([...cache.keys()]).toEqual(["a"])
    expect(cache.get("a")).toEqual(v(1))
  })

  it("leaves iteration order untouched, so a mutate filter sees each key once", () => {
    // `useInvalidate` iterates keys() and writes back through set() for the
    // matches. An LRU that re-inserted on read would reorder mid-iteration.
    const cache = createBoundedCache(base(), 10)
    cache.set("a", v(1))
    cache.set("b", v(2))
    cache.set("c", v(3))
    cache.get("a")

    expect([...cache.keys()]).toEqual(["a", "b", "c"])
  })

  it("counts what the inherited cache already holds", () => {
    // `provider` is handed the PARENT cache, not an empty one, so a wrapper
    // that started its count at zero would allow `limit` more entries on top of
    // however many were already there.
    const cache = createBoundedCache(base([["x", v(1)], ["y", v(2)]]), 2)
    cache.set("z", v(3))
    expect([...cache.keys()].length).toBeLessThanOrEqual(2)
  })
})
