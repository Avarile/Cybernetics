"use client"

import { useCallback, useEffect, useRef } from "react"
import { useApi } from "@/lib/api/provider"
import { rowsOf, type Paginated } from "@/lib/api/types"
import { selectIsAuthenticated, useAuthStore } from "@/stores/auth.store"
import { resolveHealth, useDomainStore, type DomainState } from "@/stores/domain.store"
import { DOMAINS } from "./data/domains"

/** How often to re-read the counts while the tab is visible. */
export const POLL_MS = 30_000

/**
 * Keeps `domain.store` in step with the API.
 *
 * One `?page=1&limit=1` request per domain, reading `total` off the standard
 * list envelope — cheap, and needs no bespoke stats endpoint. A domain with an
 * `attentionEndpoint` costs a second call.
 *
 * Polling pauses while the tab is hidden and resumes with an immediate sync, so
 * a backgrounded tab does not spend the user's rate limit on a view nobody is
 * looking at.
 */
export function useDomainHealth(): { refresh: () => void } {
  const { client } = useApi()
  const authed = useAuthStore(selectIsAuthenticated)
  const setMany = useDomainStore((s) => s.setMany)
  const reset = useDomainStore((s) => s.reset)

  // Guards against two syncs overlapping when a visibility change lands on top
  // of a scheduled tick.
  const inFlight = useRef(false)

  const sync = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const entries = await Promise.all(
        DOMAINS.map(async (d): Promise<[string, DomainState]> => {
          try {
            const page = await client.get<Paginated<unknown>>(
              `${d.countEndpoint}?page=1&limit=1`,
            )
            const count = typeof page?.total === "number" ? page.total : null

            let needsAttention = false
            if (d.attentionEndpoint) {
              try {
                const flagged = await client.get<unknown>(d.attentionEndpoint)
                // Attention probes answer as either a bare array
                // (/agent/approvals) or a list envelope, whose rows may be
                // under `data` or `items` — see rowsOf.
                needsAttention = Array.isArray(flagged)
                  ? flagged.length > 0
                  : rowsOf(flagged as Paginated<unknown>).length > 0
              } catch {
                // An attention probe that fails is not itself an error state —
                // the domain is still reachable, we just cannot escalate it.
              }
            }

            return [d.key, { count, health: resolveHealth({ count, needsAttention }) }]
          } catch (err) {
            return [
              d.key,
              {
                count: null,
                health: "error",
                error: err instanceof Error ? err.message : "unreachable",
              },
            ]
          }
        }),
      )
      setMany(Object.fromEntries(entries))
    } finally {
      inFlight.current = false
    }
  }, [client, setMany])

  useEffect(() => {
    // Counts are owner-scoped; polling them signed-out is guaranteed 401s.
    if (!authed) {
      reset()
      return
    }

    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (timer != null) return
      timer = setInterval(() => void sync(), POLL_MS)
    }
    const stop = () => {
      if (timer == null) return
      clearInterval(timer)
      timer = null
    }

    const onVisibility = () => {
      if (document.hidden) {
        stop()
      } else {
        void sync()
        start()
      }
    }

    void sync()
    start()
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [authed, sync, reset])

  return { refresh: () => void sync() }
}
