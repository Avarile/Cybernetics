import type { ComponentType } from "react"
import type { LucideIcon } from "lucide-react"
import type { JsonObject } from "@/lib/state/json"

export type WindowKind =
  | "auth"
  | "terminal"
  | "voice"
  | "settings"
  /**
   * Every data domain, in one window.
   *
   * Replaces the per-domain kinds (`contacts`, `files`, and the never-built
   * `knowledge` / `projects` / `finance` / …). Six domains span ~28 distinct
   * resources between them; a kind each would mean 28 registry entries, 28
   * dock chips, and a user hunting for where Budgets lives. The sideNav inside
   * this one window routes them instead.
   */
  | "data"
  | "mailbox"
  | "search"
  | "record-create"
  | "record-edit"
  | "record-detail"
  | "confirm"

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * One state, deliberately.
 *
 * Minimise and maximise were removed along with the dock: a window is either
 * open or closed. Kept as a named union rather than folded away so the field
 * stays greppable and a future state has somewhere to go.
 */
export type WindowState = "normal"

export interface WindowInstance {
  id: string
  kind: WindowKind
  title: string
  /**
   * JSON-only, because instances are persisted. Typing this as JsonObject turns
   * "a callback silently vanished through JSON.stringify" into a compile error.
   */
  props?: JsonObject
  rect: Rect
  minSize?: { w: number; h: number }
  zIndex: number
  state: WindowState
  /** true ⇒ scrim + focus trap, and drawn in the always-higher modal band. */
  modal: boolean
}

/**
 * A window body.
 *
 * Typed loosely on purpose: `WindowInstance.props` is an untyped bag filled at
 * the `openWindow` call site, so the registry cannot know a body's prop shape.
 * Narrowing this to `ComponentType<Record<string, unknown>>` would force every
 * body to declare all of its props optional, which hides genuine requirements
 * — ConfirmWindow really does need a `message`. The typing that matters is at
 * the call site and inside each body.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WindowBody = ComponentType<any>

export interface WindowMeta {
  kind: WindowKind
  title: string
  icon: LucideIcon
  /** Focus-if-open instead of spawning a duplicate. */
  singleton: boolean
  /** true ⇒ scrim + focus trap, and drawn in the always-higher modal band. */
  modal: boolean
  /**
   * "none" ⇒ WindowLayer centres the body itself and draws no frame: no title
   * bar, no window controls, no resize grips. For a gate like the auth dialog,
   * where the body is already a Card and there is nothing legitimate to close.
   */
  chrome?: "frame" | "none"
  /**
   * Where an auto-placed window lands.
   *
   * "cascade" (the default) offsets each new window from its predecessor, which
   * is right for the record windows — several can be open at once and stacking
   * them exactly would hide all but the last.
   *
   * "centre" is for the windows that ARE the task and are singletons: the data
   * tables, the terminal, and a modal confirm, which under a scrim in the
   * top-left corner reads as a rendering fault rather than a dialog.
   *
   * Ignored when the opener passes an explicit `rect.x` — a caller that placed
   * the window means it.
   */
  placement?: "cascade" | "centre"
  defaultRect?: Partial<Rect>
  minSize?: { w: number; h: number }
}
