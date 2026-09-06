import { create } from "zustand"
import type { Health } from "@/components/system-core/data/status"

export interface DomainState {
  /** Row count from the list envelope's `total`. */
  count: number | null
  health: Health
  /** Set when the count call failed, for a tooltip. */
  error?: string
}

interface DomainStoreState {
  byKey: Record<string, DomainState>
  lastSyncedAt: number | null

  setDomain: (key: string, state: DomainState) => void
  setMany: (entries: Record<string, DomainState>) => void
  healthFor: (key: string) => Health
  reset: () => void
}

const UNKNOWN: DomainState = { count: null, health: "unknown" }

export const useDomainStore = create<DomainStoreState>((set, get) => ({
  byKey: {},
  lastSyncedAt: null,

  setDomain: (key, state) =>
    set((s) => ({ byKey: { ...s.byKey, [key]: state } })),

  setMany: (entries) =>
    set((s) => ({
      byKey: { ...s.byKey, ...entries },
      // Stamped by the caller's clock rather than Date.now() inside the store,
      // so tests do not have to fake timers to assert a sync happened.
      lastSyncedAt: s.lastSyncedAt,
    })),

  healthFor: (key) => (get().byKey[key] ?? UNKNOWN).health,

  reset: () => set({ byKey: {}, lastSyncedAt: null }),
}))

/**
 * Turns a domain's raw signals into the health its band renders with.
 *
 * Pure, and exported separately from the store so the mapping can be tested
 * without a store or a network.
 */
export function resolveHealth(input: {
  count: number | null
  failed?: boolean
  /** Something is running right now: an agent turn, an upload. */
  busy?: boolean
  /** Pending approvals, at-risk budgets, failed ingests. */
  needsAttention?: boolean
}): Health {
  if (input.failed) return "error"
  if (input.needsAttention) return "attention"
  if (input.busy) return "active"
  if (input.count == null) return "unknown"
  return "nominal"
}
