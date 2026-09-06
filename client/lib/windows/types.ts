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

export interface WindowDescriptor {
  kind: WindowKind
  title: string
  icon: LucideIcon
  /** Focus-if-open instead of spawning a duplicate. */
  singleton: boolean
  modal?: boolean
  defaultRect?: Partial<Rect>
  minSize?: { w: number; h: number }
  component: LazyExoticComponent<ComponentType<Record<string, unknown>>>
}
