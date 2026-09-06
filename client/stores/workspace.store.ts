import { nanoid } from "nanoid"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { immer } from "zustand/middleware/immer"
import { createLegacyAwareStorage } from "@/lib/state/persist-storage"
import { readLegacyWindows } from "@/lib/state/legacy-storage"
import { cascade, clampToViewport } from "@/lib/windows/geometry"
import { WINDOW_REGISTRY } from "@/lib/windows/registry"
import { useViewportStore } from "./viewport.store"
import type { Rect, WindowInstance, WindowKind } from "@/lib/windows/types"

export const WORKSPACE_STORAGE_KEY = "cyb.windows"

/**
 * Modal windows live in their own, always-higher band, so focusing a non-modal
 * window can never raise it above the auth dialog.
 */
export const MODAL_Z_BASE = 10_000

/** Where the modal scrim sits: above every non-modal window, below the modal
 *  band. Derived so it cannot drift from MODAL_Z_BASE. */
export const MODAL_SCRIM_Z = MODAL_Z_BASE - 1

const DEFAULT_RECT: Rect = { x: 80, y: 80, w: 900, h: 600 }

/**
 * Kinds whose contents are transient. Restoring these after a reload would
 * resurrect a half-filled form, or a dialog the user already dealt with.
 */
const NEVER_PERSIST: ReadonlySet<WindowKind> = new Set<WindowKind>([
  "auth",
  "confirm",
  "record-create",
  "record-edit",
  "record-detail",
])

export interface OpenWindowInput {
  kind: WindowKind
  title?: string
  props?: Record<string, unknown>
  modal?: boolean
  /** De-duplication identity. Defaults to `kind`, which makes it a singleton. */
  singletonKey?: string
  rect?: Partial<Rect>
}

interface WorkspaceState {
  windows: WindowInstance[]
  zSeq: number

  openWindow: (input: OpenWindowInput) => string
  closeWindow: (id: string) => void
  focusWindow: (id: string) => void
  minimiseWindow: (id: string) => void
  restoreWindow: (id: string) => void
  toggleMaximise: (id: string) => void
  moveWindow: (id: string, rect: Rect) => void
  closeAll: () => void
}

/** Persisted slice. Only the workspace — never in-flight work. */
interface PersistedWorkspace {
  windows: WindowInstance[]
  zSeq: number
}

/** The de-duplication identity for an existing instance. */
function keyOf(w: WindowInstance): string {
  return (w.props?.__key as string | undefined) ?? w.kind
}

function isRect(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false
  const r = v as Record<string, unknown>
  // Number.isFinite, not typeof: JSON.parse turns an overflowing literal like
  // 1e999 into Infinity, which is typeof "number" and would survive into the
  // geometry maths.
  return (["x", "y", "w", "h"] as const).every((k) => Number.isFinite(r[k]))
}

/**
 * Validates a stored instance before it reaches the store.
 *
 * localStorage is user-writable and survives deploys, so a payload here can be
 * stale or hand-edited.
 */
export function isRestorable(v: unknown): v is WindowInstance {
  if (typeof v !== "object" || v === null) return false
  const w = v as Record<string, unknown>
  return (
    typeof w.id === "string" &&
    typeof w.kind === "string" &&
    typeof w.title === "string" &&
    // Finite, not merely numeric: an Infinity here would poison zSeq for the
    // whole session, since every later nextZ derives from it.
    Number.isFinite(w.zIndex) &&
    (w.state === "normal" || w.state === "minimised" || w.state === "maximised") &&
    w.modal === false &&
    isRect(w.rect) &&
    Object.hasOwn(WINDOW_REGISTRY, w.kind as string)
  )
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    immer((set, get) => ({
      windows: [],
      zSeq: 0,

      // Today's body, with two changes and no others: the viewport comes from
      // the new store, and the final write is an immer mutation. Descriptor
      // resolution is Task 7's job — do not reach for WINDOW_META here.
      openWindow: (input) => {
        const key = input.singletonKey ?? input.kind
        const existing = get().windows.find((w) => keyOf(w) === key)

        if (existing) {
          get().focusWindow(existing.id)
          if (get().windows.find((w) => w.id === existing.id)?.state === "minimised") {
            get().restoreWindow(existing.id)
          }
          return existing.id
        }

        const id = nanoid()
        const modal = input.modal ?? false
        const viewport = useViewportStore.getState()
        const nextZ = get().zSeq + 1

        const base = clampToViewport({ ...DEFAULT_RECT, ...input.rect }, viewport)
        // An explicit x means the caller placed it; only auto-placed windows cascade.
        const rect = input.rect?.x != null ? base : cascade(get().windows.length, base, viewport)

        const instance: WindowInstance = {
          id,
          kind: input.kind,
          title: input.title ?? input.kind,
          props: { ...input.props, __key: key },
          rect,
          zIndex: modal ? MODAL_Z_BASE + nextZ : nextZ,
          state: "normal",
          modal,
        }

        set((state) => {
          state.windows.push(instance)
          state.zSeq = nextZ
        })
        return id
      },

      closeWindow: (id) =>
        set((state) => {
          state.windows = state.windows.filter((w) => w.id !== id)
        }),

      focusWindow: (id) =>
        set((state) => {
          const win = state.windows.find((w) => w.id === id)
          if (!win) return
          state.zSeq += 1
          win.zIndex = win.modal ? MODAL_Z_BASE + state.zSeq : state.zSeq
        }),

      minimiseWindow: (id) =>
        set((state) => {
          const win = state.windows.find((w) => w.id === id)
          if (win) win.state = "minimised"
        }),

      restoreWindow: (id) =>
        set((state) => {
          const win = state.windows.find((w) => w.id === id)
          if (win) win.state = "normal"
        }),

      toggleMaximise: (id) =>
        set((state) => {
          const win = state.windows.find((w) => w.id === id)
          if (win) win.state = win.state === "maximised" ? "normal" : "maximised"
        }),

      moveWindow: (id, rect) =>
        set((state) => {
          const win = state.windows.find((w) => w.id === id)
          if (win) win.rect = clampToViewport(rect, useViewportStore.getState())
        }),

      closeAll: () =>
        set((state) => {
          state.windows = []
          state.zSeq = 0
        }),
    })),
    {
      name: WORKSPACE_STORAGE_KEY,
      version: 1,
      skipHydration: true,
      partialize: (state): PersistedWorkspace => ({
        windows: serialiseForPersist(state.windows),
        zSeq: state.zSeq,
      }),
      storage: createLegacyAwareStorage<PersistedWorkspace>({
        version: 1,
        legacy: {
          key: WORKSPACE_STORAGE_KEY,
          read: (raw) => readLegacyWindows(raw, isRestorable),
        },
      }),
    },
  ),
)

export const selectOpenWindows = (st: WorkspaceState): WindowInstance[] =>
  st.windows.filter((w) => w.state !== "minimised").sort((a, b) => a.zIndex - b.zIndex)

export const selectMinimised = (st: WorkspaceState): WindowInstance[] =>
  st.windows.filter((w) => w.state === "minimised")

export const selectTopModal = (st: WorkspaceState): WindowInstance | null =>
  st.windows.filter((w) => w.modal).sort((a, b) => b.zIndex - a.zIndex)[0] ?? null

/** What survives a reload: the user's workspace, never their in-flight work. */
export function serialiseForPersist(windows: WindowInstance[]): WindowInstance[] {
  return windows.filter((w) => !w.modal && !NEVER_PERSIST.has(w.kind))
}
