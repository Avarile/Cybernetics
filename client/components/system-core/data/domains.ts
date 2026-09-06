import {
  BellIcon,
  BookIcon,
  CoinsIcon,
  FileIcon,
  InboxIcon,
  KanbanIcon,
  TerminalIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"
import type { WindowKind } from "@/lib/windows/types"

/**
 * The eight feature domains the stack is built from.
 *
 * This is the keystone of design 4.2: the 3D core, the dock and (later) the
 * command palette all read from this one table, so a domain is declared once.
 *
 * Every `countEndpoint` below was checked against a real `@Controller` in
 * `api/src/features/**`. Two are deliberately not the obvious path:
 *
 *   mailbox  — `/mailbox` has NO root list; only `/mailbox/messages` exists.
 *   finance  — `/finance` has no root list at all. It is a cluster of
 *              sub-resources, so the strip counts `/invoices` (its own
 *              top-level controller) and escalates from budgets-at-risk.
 */
export interface Domain {
  key: string
  label: string
  /** Which window a click on this strip opens. */
  window: WindowKind
  /** Paginated list endpoint; the strip reads `total` from the envelope. */
  countEndpoint: string
  /** Optional second call whose non-empty result forces `attention`. */
  attentionEndpoint?: string
  icon: LucideIcon
  /** Position in the stack, bottom to top. */
  band: number
  /** Base geometry. Radius widens up the stack so the cone reads as a stack. */
  radius: number
  arcDeg: number
}

export const DOMAINS: readonly Domain[] = [
  {
    key: "agent",
    label: "Agent",
    window: "terminal",
    countEndpoint: "/agent/conversations",
    attentionEndpoint: "/agent/approvals",
    icon: TerminalIcon,
    band: 0,
    radius: 0.62,
    arcDeg: 210,
  },
  {
    key: "contacts",
    label: "Contacts",
    window: "contacts",
    countEndpoint: "/contacts",
    icon: UsersIcon,
    band: 1,
    radius: 0.7,
    arcDeg: 160,
  },
  {
    key: "knowledge",
    label: "Knowledge",
    window: "knowledge",
    countEndpoint: "/knowledge",
    icon: BookIcon,
    band: 2,
    radius: 0.78,
    arcDeg: 190,
  },
  {
    key: "projects",
    label: "Projects",
    window: "projects",
    countEndpoint: "/projects",
    icon: KanbanIcon,
    band: 3,
    radius: 0.86,
    arcDeg: 140,
  },
  {
    key: "files",
    label: "Files",
    window: "files",
    countEndpoint: "/files",
    icon: FileIcon,
    band: 4,
    radius: 0.94,
    arcDeg: 175,
  },
  {
    key: "mailbox",
    label: "Mailbox",
    window: "mailbox",
    // `/mailbox` has no root list — messages only.
    countEndpoint: "/mailbox/messages",
    icon: InboxIcon,
    band: 5,
    radius: 1.02,
    arcDeg: 205,
  },
  {
    key: "finance",
    label: "Finance",
    window: "finance",
    // `/finance` has no root list; invoices is its own top-level controller.
    countEndpoint: "/invoices",
    attentionEndpoint: "/finance/budgets/at-risk",
    icon: CoinsIcon,
    band: 6,
    radius: 1.1,
    arcDeg: 150,
  },
  {
    key: "notifications",
    label: "Notifications",
    window: "notifications",
    countEndpoint: "/notifications",
    icon: BellIcon,
    band: 7,
    radius: 1.18,
    arcDeg: 120,
  },
]

export const DOMAIN_BY_KEY: ReadonlyMap<string, Domain> = new Map(
  DOMAINS.map((d) => [d.key, d]),
)
