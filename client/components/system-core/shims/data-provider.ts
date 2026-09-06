/**
 * Stand-in for the reference's `~/data-provider` SystemCore queries.
 *
 * Those hooks poll two LibreChat endpoints — `/api/system-core/availability`
 * and `/api/system-core/snapshot` — backed by a Prometheus scrape. Our API has
 * neither, so this reports the feed as **unavailable**, which is a first-class
 * state in the reference rather than a degraded one: `configured: false` means
 * "the client keeps its fixture", and `useLive` maps it to `state: 'off'` with
 * an empty reading map. The scene then renders the authored arrangement from
 * `data/modules.json` exactly as the reference does with no Prometheus
 * configured.
 *
 * Everything downstream — adapt, bind, resolve, Channels, the panel's live chip
 * — is the reference's real code and is already exercised by that path. Wiring
 * a real feed later means implementing the two endpoints and replacing this
 * file; nothing above it changes.
 */

import type { SystemCoreSnapshotResponse } from "../live/types"

export interface SnapshotQueryResult {
  data: SystemCoreSnapshotResponse | undefined
  isError: boolean
}

/**
 * The reference latches a circuit breaker after repeated snapshot failures, so
 * a dead upstream is not polled forever. With no feed there is nothing to trip.
 */
export function snapshotBreakerOpen(): boolean {
  return false
}

export function resetSnapshotBreaker(): void {
  /* no feed, nothing latched */
}

/** Mirrors `useSystemCoreAvailability`. */
export function useSystemCoreAvailability(): {
  data: { configured: boolean; enabled: boolean } | undefined
} {
  return { data: { configured: false, enabled: false } }
}

/** Mirrors `useSystemCoreSnapshot`. Never resolves a snapshot. */
export function useSystemCoreSnapshot(_opts: { enabled: boolean }): SnapshotQueryResult {
  return { data: undefined, isError: false }
}

/** Mirrors `useRetrySystemCoreSnapshot`. */
export function useRetrySystemCoreSnapshot(): () => void {
  return () => undefined
}
