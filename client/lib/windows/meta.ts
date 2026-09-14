import {
  DatabaseIcon, FilePlusIcon, FileTextIcon, LockIcon, MicIcon,
  PencilIcon, ShieldAlertIcon, TerminalIcon,
} from "lucide-react"
import type { WindowKind, WindowMeta } from "./types"

/**
 * Descriptor data for every window kind, with no React component in sight.
 *
 * Split from the registry so the workspace store can resolve a kind's title,
 * modality, singleton-ness and geometry without importing lazy component
 * chunks into Ring 1. Before the split these fields were declared here and read
 * nowhere, so every window opened at the store's 900×600 fallback.
 */
/*
 * `placement: "centre"` is on the three singleton-ish kinds that ARE the task —
 * the terminal, the data tables, and the modal confirm. The record kinds are
 * deliberately left cascading: several can be open at once, and centring them
 * would stack every one on the same pixel.
 */
export const WINDOW_META: Partial<Record<WindowKind, WindowMeta>> = {
  // No defaultRect: chrome "none" means WindowLayer centres this one and never
  // reads its rect. Do not reinstate a rect here.
  auth: { kind: "auth", title: "Access", icon: LockIcon, singleton: true, modal: true, chrome: "none" },
  terminal: { kind: "terminal", title: "Terminal", icon: TerminalIcon, singleton: true, modal: false, placement: "centre", defaultRect: { w: 900, h: 600 }, minSize: { w: 420, h: 320 } },
  // Wider and taller than the domain windows it replaces: it carries a sideNav
  // rail (16rem) and a section tab row before the table gets any space.
  // defaultRect is a *request*, not a promise: `clampToViewport` shrinks it to
  // the viewport less a 16px margin, so 1920x1080 means "open as large as this
  // screen allows" on anything smaller. Keep defaultRect >= minSize, or the
  // window would open smaller than the first resize drag is allowed to make it.
  data: { kind: "data", title: "Data", icon: DatabaseIcon, singleton: true, modal: false, placement: "centre", defaultRect: { w: 1920, h: 1080 }, minSize: { w: 960, h: 760 } },
  "record-create": { kind: "record-create", title: "New record", icon: FilePlusIcon, singleton: false, modal: false, defaultRect: { w: 460, h: 600 } },
  "record-edit": { kind: "record-edit", title: "Edit record", icon: PencilIcon, singleton: false, modal: false, defaultRect: { w: 460, h: 600 } },
  "record-detail": { kind: "record-detail", title: "Record", icon: FileTextIcon, singleton: false, modal: false, defaultRect: { w: 460, h: 600 } },
  confirm: { kind: "confirm", title: "Confirm", icon: ShieldAlertIcon, singleton: false, modal: true, placement: "centre", defaultRect: { w: 420, h: 220 } },
  voice: { kind: "voice", title: "Live", icon: MicIcon, singleton: true, modal: false, defaultRect: { w: 420, h: 480 } },
}
