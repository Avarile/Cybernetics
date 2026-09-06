import { lazy } from "react"
import {
  FileIcon,
  FilePlusIcon,
  FileTextIcon,
  LockIcon,
  MicIcon,
  PencilIcon,
  ShieldAlertIcon,
  TerminalIcon,
  UsersIcon,
} from "lucide-react"
import type { WindowBody, WindowDescriptor, WindowKind } from "./types"

/**
 * Pins the `mode` for the three record kinds, so one RecordWindow serves
 * create, edit and detail without the opener having to pass it every time.
 */
function withMode<P extends object>(
  Component: React.ComponentType<P & { mode: string }>,
  mode: string,
): WindowBody {
  const Wrapped = (props: P) => <Component {...props} mode={mode} />
  Wrapped.displayName = `withMode(${mode})`
  return Wrapped
}

/**
 * Every window kind that can currently be opened.
 *
 * Components are lazy so a window's code is fetched the first time it opens,
 * not at boot. This map is the single place a new feature window is wired in —
 * later phases add entries here and change nothing else.
 *
 * Kinds absent from this map are ignored by WindowLayer, so declaring a kind in
 * `WindowKind` ahead of its implementation is safe.
 */
export const WINDOW_REGISTRY: Partial<Record<WindowKind, WindowDescriptor>> = {
  auth: {
    kind: "auth",
    title: "Access",
    icon: LockIcon,
    singleton: true,
    modal: true,
    defaultRect: { w: 420, h: 520 },
    component: lazy(() =>
      import("@/components/auth/auth-window").then((m) => ({ default: m.AuthWindow })),
    ),
  },
  terminal: {
    kind: "terminal",
    title: "Terminal",
    icon: TerminalIcon,
    singleton: true,
    defaultRect: { w: 900, h: 600 },
    minSize: { w: 420, h: 320 },
    component: lazy(() =>
      import("@/components/terminal/terminal-window").then((m) => ({
        default: m.TerminalWindow,
      })),
    ),
  },
  contacts: {
    kind: "contacts",
    title: "Contacts",
    icon: UsersIcon,
    singleton: true,
    defaultRect: { w: 980, h: 620 },
    minSize: { w: 520, h: 360 },
    component: lazy(() =>
      import("@/components/domains/contacts-window").then((m) => ({
        default: m.ContactsWindow,
      })),
    ),
  },
  files: {
    kind: "files",
    title: "Files",
    icon: FileIcon,
    singleton: true,
    defaultRect: { w: 980, h: 660 },
    minSize: { w: 520, h: 400 },
    component: lazy(() =>
      import("@/components/domains/files-window").then((m) => ({
        default: m.FilesWindow,
      })),
    ),
  },
  "record-create": {
    kind: "record-create",
    title: "New record",
    icon: FilePlusIcon,
    singleton: false,
    defaultRect: { w: 460, h: 600 },
    component: lazy(() =>
      import("@/components/data-table/record-window").then((m) => ({
        default: withMode(m.RecordWindow, "create"),
      })),
    ),
  },
  "record-edit": {
    kind: "record-edit",
    title: "Edit record",
    icon: PencilIcon,
    singleton: false,
    defaultRect: { w: 460, h: 600 },
    component: lazy(() =>
      import("@/components/data-table/record-window").then((m) => ({
        default: withMode(m.RecordWindow, "edit"),
      })),
    ),
  },
  "record-detail": {
    kind: "record-detail",
    title: "Record",
    icon: FileTextIcon,
    singleton: false,
    defaultRect: { w: 460, h: 600 },
    component: lazy(() =>
      import("@/components/data-table/record-window").then((m) => ({
        default: withMode(m.RecordWindow, "detail"),
      })),
    ),
  },
  confirm: {
    kind: "confirm",
    title: "Confirm",
    icon: ShieldAlertIcon,
    singleton: false,
    modal: true,
    defaultRect: { w: 420, h: 220 },
    component: lazy(() =>
      import("@/components/windows/confirm-window").then((m) => ({
        default: m.ConfirmWindow,
      })),
    ),
  },
  voice: {
    kind: "voice",
    title: "Live",
    icon: MicIcon,
    singleton: true,
    defaultRect: { w: 420, h: 480 },
    component: lazy(() =>
      import("@/components/windows/placeholder-window").then((m) => ({
        default: m.PlaceholderWindow,
      })),
    ),
  },
}
