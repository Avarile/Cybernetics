import { lazy, type LazyExoticComponent } from "react"
import type { WindowBody, WindowKind } from "./types"

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
 * The lazy component for every window kind that can currently be opened.
 *
 * Components are lazy so a window's code is fetched the first time it opens,
 * not at boot. This map is the single place a new feature window is wired in —
 * later phases add entries here and change nothing else.
 *
 * A kind's title, icon, modality and geometry live in `WINDOW_META` instead —
 * split out so consumers that only need that data (the workspace store) don't
 * pull lazy component chunks and the lucide icon set along with it.
 *
 * Kinds absent from this map are ignored by WindowLayer, so declaring a kind in
 * `WindowKind` ahead of its implementation is safe.
 */
export const WINDOW_COMPONENTS: Partial<Record<WindowKind, LazyExoticComponent<WindowBody>>> = {
  auth: lazy(() =>
    import("@/components/auth/auth-window").then((m) => ({ default: m.AuthWindow })),
  ),
  terminal: lazy(() =>
    import("@/components/terminal/terminal-window").then((m) => ({
      default: m.TerminalWindow,
    })),
  ),
  contacts: lazy(() =>
    import("@/components/domains/contacts-window").then((m) => ({
      default: m.ContactsWindow,
    })),
  ),
  files: lazy(() =>
    import("@/components/domains/files-window").then((m) => ({
      default: m.FilesWindow,
    })),
  ),
  "record-create": lazy(() =>
    import("@/components/data-table/record-window").then((m) => ({
      default: withMode(m.RecordWindow, "create"),
    })),
  ),
  "record-edit": lazy(() =>
    import("@/components/data-table/record-window").then((m) => ({
      default: withMode(m.RecordWindow, "edit"),
    })),
  ),
  "record-detail": lazy(() =>
    import("@/components/data-table/record-window").then((m) => ({
      default: withMode(m.RecordWindow, "detail"),
    })),
  ),
  confirm: lazy(() =>
    import("@/components/windows/confirm-window").then((m) => ({
      default: m.ConfirmWindow,
    })),
  ),
  voice: lazy(() =>
    import("@/components/windows/placeholder-window").then((m) => ({
      default: m.PlaceholderWindow,
    })),
  ),
}
