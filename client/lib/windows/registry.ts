import { lazy } from "react"
import { LockIcon, MicIcon, TerminalIcon } from "lucide-react"
import type { WindowDescriptor, WindowKind } from "./types"

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
