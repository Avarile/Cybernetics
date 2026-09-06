import { nanoid } from "nanoid"
import { create } from "zustand"
import { cascade, clampToViewport, type Viewport } from "@/lib/windows/geometry"
import type { Rect, WindowInstance, WindowKind } from "@/lib/windows/types"

export const WINDOW_STORAGE_KEY = "cyb.windows"

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

interface WindowStoreState {
  windows: WindowInstance[]
  zSeq: number
  viewport: Viewport

  setViewport: (v: Viewport) => void
  openWindow: (input: OpenWindowInput) => string
  closeWindow: (id: string) => void
  focusWindow: (id: string) => void
  minimiseWindow: (id: string) => void
  restoreWindow: (id: string) => void
  toggleMaximise: (id: string) => void
  moveWindow: (id: string, rect: Rect) => void
  closeAll: () => void
  hydrate: (windows: WindowInstance[]) => void
}

/** The de-duplication identity for an existing instance. */
function keyOf(w: WindowInstance): string {
  return (w.props?.__key as string | undefined) ?? w.kind
}

export const useWindowStore = create<WindowStoreState>((set, get) => ({
  windows: [],
  zSeq: 0,
  viewport: { w: 1440, h: 900 },

  setViewport: (viewport) => set({ viewport }),

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
    const { windows, zSeq, viewport } = get()
    const nextZ = zSeq + 1

    const base = clampToViewport({ ...DEFAULT_RECT, ...input.rect }, viewport)
    // An explicit x means the caller placed it; only auto-placed windows cascade.
    const rect = input.rect?.x != null ? base : cascade(windows.length, base, viewport)

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

    set({ windows: [...windows, instance], zSeq: nextZ })
    return id
  },

  closeWindow: (id) => set((st) => ({ windows: st.windows.filter((w) => w.id !== id) })),

  focusWindow: (id) =>
    set((st) => {
      if (!st.windows.some((w) => w.id === id)) return st
      const nextZ = st.zSeq + 1
      return {
        zSeq: nextZ,
        windows: st.windows.map((w) =>
          w.id === id ? { ...w, zIndex: w.modal ? MODAL_Z_BASE + nextZ : nextZ } : w,
        ),
      }
    }),

  minimiseWindow: (id) =>
    set((st) => ({
      windows: st.windows.map((w) => (w.id === id ? { ...w, state: "minimised" } : w)),
    })),

  restoreWindow: (id) =>
    set((st) => ({
      windows: st.windows.map((w) => (w.id === id ? { ...w, state: "normal" } : w)),
    })),

  toggleMaximise: (id) =>
    set((st) => ({
      windows: st.windows.map((w) =>
        w.id === id ? { ...w, state: w.state === "maximised" ? "normal" : "maximised" } : w,
      ),
    })),

  moveWindow: (id, rect) =>
    set((st) => ({
      windows: st.windows.map((w) =>
        w.id === id ? { ...w, rect: clampToViewport(rect, st.viewport) } : w,
      ),
    })),

  closeAll: () => set({ windows: [], zSeq: 0 }),

  hydrate: (windows) =>
    set({ windows, zSeq: windows.reduce((m, w) => Math.max(m, w.zIndex), 0) }),
}))

export const selectOpenWindows = (st: WindowStoreState): WindowInstance[] =>
  st.windows.filter((w) => w.state !== "minimised").sort((a, b) => a.zIndex - b.zIndex)

export const selectMinimised = (st: WindowStoreState): WindowInstance[] =>
  st.windows.filter((w) => w.state === "minimised")

export const selectTopModal = (st: WindowStoreState): WindowInstance | null =>
  st.windows.filter((w) => w.modal).sort((a, b) => b.zIndex - a.zIndex)[0] ?? null

/** What survives a reload: the user's workspace, never their in-flight work. */
export function serialiseForPersist(windows: WindowInstance[]): WindowInstance[] {
  return windows.filter((w) => !w.modal && !NEVER_PERSIST.has(w.kind))
}
