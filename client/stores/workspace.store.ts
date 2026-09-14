import { nanoid } from "nanoid"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { immer } from "zustand/middleware/immer"
import { createLegacyAwareStorage } from "@/lib/state/persist-storage"
import { readLegacyWindows } from "@/lib/state/legacy-storage"
import { cascade, centreInViewport, clampToViewport } from "@/lib/windows/geometry"
import { WINDOW_META } from "@/lib/windows/meta"
import type { JsonObject } from "@/lib/state/json"
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
  props?: JsonObject
  modal?: boolean
  /**
   * De-duplication identity: `openWindow` focuses the existing instance whose
   * key matches instead of opening a second one.
   *
   * The default is the kind — a singleton — EXCEPT for a kind whose
   * `WINDOW_META` declares `singleton: false`, where it is a fresh id and each
   * call opens another instance. Passing one explicitly gives such a kind a
   * de-duplication identity of its own; `files-window.tsx` does that with
   * `confirm:files:<ids>` so one confirm dialog per selection, not per click.
   */
  singletonKey?: string
  rect?: Partial<Rect>
}

interface WorkspaceState {
  windows: WindowInstance[]
  zSeq: number

  openWindow: (input: OpenWindowInput) => string
  /**
   * Merge a patch into one window's props.
   *
   * Navigation state (which domain, which section, which scope the Data window
   * shows) lives in props rather than a store of its own: props are already in
   * the persisted slice, so a reopened workspace lands back where it was, and
   * `openWindow({ kind: "data", props: { domain, section } })` is a deep link
   * with no extra machinery.
   *
   * Deliberately does NOT touch zSeq or zIndex. Changing a section is
   * navigation, not focus — a tab click that raised the window over a modal
   * would be a bug.
   */
  patchWindowProps: (id: string, patch: JsonObject) => void
  closeWindow: (id: string) => void
  focusWindow: (id: string) => void
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
 * stale or hand-edited. Applied on EVERY rehydrate, through the persist `merge`
 * below, and not only on the one-time legacy conversion — otherwise the
 * guarantee would hold for exactly the first load after the upgrade and never
 * again, since `getItem` hands back a parsed envelope unvalidated.
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
    // Any of the three states a previous build could have written. A payload
    // saying "minimised" is still a restorable window — `merge` normalises it
    // to "normal" below rather than dropping it, because a window this rejects
    // is gone for good and the dock that could have brought it back no longer
    // exists.
    (w.state === "normal" || w.state === "minimised" || w.state === "maximised") &&
    w.modal === false &&
    isRect(w.rect) &&
    Object.hasOwn(WINDOW_META, w.kind as string)
  )
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    immer((set, get) => ({
      windows: [],
      zSeq: 0,

      // Resolves the kind's declared meta (title, modality, geometry) before
      // falling back to input and then to the store's own defaults, so a
      // caller only needs to override what's actually different for it.
      openWindow: (input) => {
        const meta = WINDOW_META[input.kind]
        // Every kind used to be an implicit singleton (singletonKey defaulted
        // to kind). A kind declared `singleton: false` now gets a unique key
        // of its own unless the caller supplies one explicitly.
        const key = input.singletonKey ?? (meta?.singleton === false ? nanoid() : input.kind)
        const existing = get().windows.find((w) => keyOf(w) === key)

        if (existing) {
          get().focusWindow(existing.id)
          return existing.id
        }

        const id = nanoid()
        const modal = input.modal ?? meta?.modal ?? false
        const viewport = useViewportStore.getState()
        const nextZ = get().zSeq + 1

        const base = clampToViewport(
          { ...DEFAULT_RECT, ...meta?.defaultRect, ...input.rect },
          viewport,
        )
        // An explicit x means the caller placed it and nothing here may move it.
        // Otherwise the kind's declared placement decides: "centre" for the
        // singleton windows that are the task (terminal, data, confirm), and
        // the cascade offset for everything else, where several instances can
        // be open at once and stacking them exactly would hide all but the last.
        const rect =
          input.rect?.x != null
            ? base
            : meta?.placement === "centre"
              ? centreInViewport(base, viewport)
              : cascade(get().windows.length, base, viewport)

        const instance: WindowInstance = {
          id,
          kind: input.kind,
          title: input.title ?? meta?.title ?? input.kind,
          props: { ...input.props, __key: key },
          rect,
          minSize: meta?.minSize,
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

      patchWindowProps: (id, patch) =>
        set((state) => {
          const win = state.windows.find((w) => w.id === id)
          if (!win) return
          // `__key` is the de-duplication identity `keyOf` reads. A patch that
          // dropped or overwrote it would orphan the window from its own
          // singleton slot, and the next openWindow for that kind would spawn
          // a second one instead of focusing this.
          const key = win.props?.__key
          win.props = {
            ...win.props,
            ...patch,
            ...(key === undefined ? {} : { __key: key }),
          }
        }),

      closeWindow: (id) =>
        set((state) => {
          state.windows = state.windows.filter((w) => w.id !== id)
        }),

      /**
       * Raise a window — and do NOTHING when it is already raised.
       *
       * The early return is load-bearing, not a micro-optimisation. Every
       * WindowFrame calls this from `onPointerDown` on its root, so it fires on
       * every click ANYWHERE inside a window: a checkbox, a tab, a row, a menu
       * item. Without the guard each of those bumped zSeq and reassigned
       * zIndex, and because this store is persisted, every one of them cost a
       * full `JSON.stringify` of the window array plus the read-back that
       * `createLegacyAwareStorage.setItem` does for its same-key legacy guard —
       * and re-rendered every `useWorkspace()` subscriber, which includes one
       * `useRecordWindows` per mounted table and every domain `useExtras` hook.
       * Clicking a checkbox in a data table re-sorted and re-rendered the whole
       * table. It also left zSeq climbing without bound across a session.
       */
      focusWindow: (id) =>
        set((state) => {
          const win = state.windows.find((w) => w.id === id)
          if (!win) return
          // Top of its OWN band: a non-modal window is never asked to out-rank
          // the modal band, so comparing against every window would leave a
          // non-modal window rewriting its zIndex forever while a modal is up.
          const top = state.windows.reduce(
            (max, w) => (w.modal === win.modal ? Math.max(max, w.zIndex) : max),
            0,
          )
          if (win.zIndex === top) return
          state.zSeq += 1
          win.zIndex = win.modal ? MODAL_Z_BASE + state.zSeq : state.zSeq
        }),

      moveWindow: (id, rect) =>
        set((state) => {
          const win = state.windows.find((w) => w.id === id)
          if (!win) return
          const next = clampToViewport(rect, useViewportStore.getState())
          // Same reasoning as focusWindow: a drag that ends where it started
          // must not cost a serialise and a re-render of every subscriber.
          if (
            win.rect.x === next.x &&
            win.rect.y === next.y &&
            win.rect.w === next.w &&
            win.rect.h === next.h
          ) {
            return
          }
          win.rect = next
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
      // The envelope is as untrustworthy as the legacy payload was: a
      // truncated write, a hand edit, or a deploy that retires a WindowKind all
      // reach the store through here. Without this, a non-finite `zIndex`
      // poisons `zSeq` for the session and a ghost window silently occupies its
      // kind's singleton slot, rendering nothing.
      merge: (persisted, current) => {
        const saved = persisted as Partial<PersistedWorkspace> | null | undefined
        // Empty storage still reaches `merge`: zustand calls it with
        // `undefined` when `getItem` returns null, and applies the result with
        // `set(state, true)` — a REPLACE. Falling through would hand back
        // `windows: []` and wipe anything opened before `rehydrate()` ran,
        // which `skipHydration` makes an ordinary ordering rather than an
        // exotic one. The default merge is a no-op on this path; so is this.
        if (saved == null) return current
        const viewport = useViewportStore.getState()
        const windows = (Array.isArray(saved.windows) ? saved.windows : [])
          .filter(isRestorable)
          .map((w) => ({
            ...w,
            // Minimise and maximise are gone. A payload written by an older
            // build can still carry either, and leaving it would resurrect a
            // window in a state nothing can render or escape from.
            state: "normal" as const,
            // Re-clamped on the way in, not merely on the way out. A layout
            // saved on a wide monitor restores on a laptop with the same
            // 1920x1080 rect at the same offset — half of it off-screen, and
            // nothing re-clamps until the user drags it.
            //
            // A kind declaring `placement: "centre"` is re-centred rather than
            // merely clamped, so "always centred when opened" survives a reload.
            // Without this the declaration held for exactly the first open and
            // never again: the rect persists, so a window dragged into a corner
            // came back in that corner for the rest of the profile's life.
            // Position only — the saved w/h is the size the user chose.
            rect:
              WINDOW_META[w.kind as WindowKind]?.placement === "centre"
                ? centreInViewport(w.rect, viewport)
                : clampToViewport(w.rect, viewport),
          }))
        return {
          ...current,
          windows,
          // Re-derived from the survivors rather than taken from the envelope:
          // a persisted `zSeq` can be non-finite or simply far ahead of
          // anything that survived the filter, and either way every later
          // `nextZ` is built on it. With no windows left it correctly returns
          // to 0. This is the same derivation `readLegacyWindows` uses.
          zSeq: windows.reduce((max, w) => Math.max(max, w.zIndex), 0),
        }
      },
    },
  ),
)

export const selectOpenWindows = (st: WorkspaceState): WindowInstance[] =>
  [...st.windows].sort((a, b) => a.zIndex - b.zIndex)

export const selectTopModal = (st: WorkspaceState): WindowInstance | null =>
  st.windows.filter((w) => w.modal).sort((a, b) => b.zIndex - a.zIndex)[0] ?? null

/** What survives a reload: the user's workspace, never their in-flight work. */
export function serialiseForPersist(windows: WindowInstance[]): WindowInstance[] {
  return windows.filter((w) => !w.modal && !NEVER_PERSIST.has(w.kind))
}
