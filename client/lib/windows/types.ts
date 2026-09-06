import type { ComponentType, LazyExoticComponent } from "react"
import type { LucideIcon } from "lucide-react"

export type WindowKind =
  | "auth"
  | "terminal"
  | "voice"
  | "settings"
  | "notifications"
  | "profile"
  | "files"
  | "contacts"
  | "knowledge"
  | "projects"
  | "tasks"
  | "mailbox"
  | "finance"
  | "invoices"
  | "tags"
  | "activity"
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

export type WindowState = "normal" | "minimised" | "maximised"

export interface WindowInstance {
  id: string
  kind: WindowKind
  title: string
  props?: Record<string, unknown>
  rect: Rect
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

export interface WindowDescriptor {
  kind: WindowKind
  title: string
  icon: LucideIcon
  /** Focus-if-open instead of spawning a duplicate. */
  singleton: boolean
  modal?: boolean
  defaultRect?: Partial<Rect>
  minSize?: { w: number; h: number }
  component: LazyExoticComponent<WindowBody>
}
