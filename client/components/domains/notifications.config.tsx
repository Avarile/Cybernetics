import { BellIcon } from "lucide-react"
import type { DomainTableConfig } from "@/components/data-table/types"
import type { DomainSpec } from "@/components/data-window/types"
import { DateCell, StatusBadge, TimeCell, dash, type StatusStyle } from "./cells"
import {
  EnabledCell,
  FrequencyCell,
  PreferenceProvider,
  QuietHoursCell,
  SuppressionEvent,
  SuppressionLookupProvider,
  useNotificationExtras,
} from "./notifications-actions"

/** The projection `notification.service.listForUser` returns — not the row. */
export interface Notification {
  id: string
  subject: string
  preview: string | null
  status: "pending" | "queued" | "sent" | "failed" | "cancelled"
  entityType: string | null
  entityId: string | null
  sentAt: string | null
  createdAt: string
}

/** The effective setting `notification-admin.listPreferences` composes. */
export interface NotificationPreference {
  /**
   * Never sent by the API — the service composes these rows from event types
   * and saved settings, so there is no row to have an id. Present only
   * because `HasId` requires it; `rowId` below keys the table on `eventKey`.
   */
  id: string
  eventKey: string
  name: string
  category: string
  isMandatory: boolean
  enabled: boolean
  frequency: "immediate" | "hourly" | "daily" | "weekly" | "off"
  quietHoursStart: number | null
  quietHoursEnd: number | null
}

export interface NotificationTemplate {
  id: string
  key: string
  locale: string
  name: string
  description: string | null
  subjectTemplate: string
  isActive: boolean
}

export interface NotificationEventType {
  id: string
  key: string
  name: string
  category: string
  description: string | null
  defaultEnabled: boolean
  isMandatory: boolean
}

export interface Suppression {
  id: string
  email: string
  reason: "hard_bounce" | "soft_bounce_repeated" | "complaint" | "unsubscribe" | "manual" | "invalid"
  /** The row references the event type by id; there is no eventKey on it. */
  eventTypeId: string | null
  expiresAt: string | null
  note: string | null
  createdAt: string
  source: string | null
}

const DELIVERY_STYLES: Record<string, StatusStyle> = {
  pending: { label: "Pending", variant: "outline" },
  queued: { label: "Queued", variant: "secondary" },
  sent: { label: "Sent", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
}

const SUPPRESSION_STYLES: Record<string, StatusStyle> = {
  hard_bounce: { label: "Hard bounce", variant: "destructive" },
  soft_bounce_repeated: { label: "Soft bounces", variant: "secondary" },
  complaint: { label: "Complaint", variant: "destructive" },
  unsubscribe: { label: "Unsubscribed", variant: "secondary" },
  manual: { label: "Manual", variant: "outline" },
  invalid: { label: "Invalid", variant: "destructive" },
}

/**
 * Your notification history.
 *
 * Read-only, and deliberately bare: `listNotificationsSchema` accepts `page`
 * and `limit` and NOTHING else — no search, no status filter, no tabs.
 * Offering controls the API silently ignores is worse than not having them,
 * which is the call `filesConfig` already makes about its missing search.
 *
 * Note also what is absent: an unread badge. `status` is a DELIVERY state
 * (pending → queued → sent), not a read receipt, and the schema has no read
 * column at all. There is nothing to compute "unread" from.
 */
export const notificationsConfig: DomainTableConfig<Notification> = {
  // No `GET /:id` on this endpoint (verified live) — seed from the row.
  noItemEndpoint: true,
  key: "notifications",
  title: "Inbox",
  endpoint: "/notifications",
  searchable: false,
  canCreate: false,
  canEdit: false,
  canDelete: false,
  selectable: false,
  emptyMessage: "No notifications yet.",
  columns: [
    {
      key: "subject",
      header: "Subject",
      cell: (r) => <span className="font-medium">{r.subject}</span>,
      hideable: false,
    },
    {
      key: "preview",
      header: "Preview",
      cell: (r) => (
        <span className="line-clamp-1 text-xs text-muted-foreground">{r.preview ?? "—"}</span>
      ),
    },
    {
      key: "status",
      header: "Delivery",
      cell: (r) => <StatusBadge value={r.status} map={DELIVERY_STYLES} />,
    },
    { key: "entityType", header: "About", cell: (r) => dash(r.entityType) },
    { key: "sentAt", header: "Sent", cell: (r) => <TimeCell value={r.sentAt} /> },
    { key: "createdAt", header: "Created", cell: (r) => <TimeCell value={r.createdAt} /> },
  ],
}

/**
 * Preferences — a settings grid, not a record list.
 *
 * Three of the five columns are editable IN PLACE. There is no create, no
 * delete, and nothing bulk-acts on a preference, so the checkbox column would
 * be a control with nothing behind it.
 *
 * Every edit PUTs the whole object: the endpoint is an upsert keyed on
 * `eventKey`, not a PATCH of one field.
 */
export const notificationPreferencesConfig: DomainTableConfig<NotificationPreference> = {
  key: "notification-preferences",
  title: "Preferences",
  endpoint: "/notifications/preferences",
  source: "collection",
  searchable: true,
  canCreate: false,
  canEdit: false,
  canDelete: false,
  selectable: false,
  // Composed rows: the service merges event types with saved settings and
  // keys the result on eventKey. There is no row to have an id.
  rowId: (r) => r.eventKey,
  emptyMessage: "No notification events are configured.",
  columns: [
    {
      key: "name",
      header: "Event",
      hideable: false,
      cell: (r) => (
        <span className="flex flex-col">
          <span className="font-medium">{r.name}</span>
          <code className="text-[10px] text-muted-foreground">{r.eventKey}</code>
        </span>
      ),
    },
    { key: "category", header: "Category", cell: (r) => dash(r.category) },
    { key: "enabled", header: "Enabled", cell: (r) => <EnabledCell row={r} /> },
    { key: "frequency", header: "Frequency", cell: (r) => <FrequencyCell row={r} /> },
    { key: "quietHoursStart", header: "Quiet hours", cell: (r) => <QuietHoursCell row={r} /> },
  ],
}

export const notificationTemplatesConfig: DomainTableConfig<NotificationTemplate> = {
  key: "notification-templates",
  title: "Templates",
  endpoint: "/system/notifications/templates",
  source: "collection",
  searchable: true,
  canCreate: false,
  canEdit: false,
  canDelete: false,
  selectable: false,
  emptyMessage: "No templates configured.",
  columns: [
    { key: "name", header: "Name", cell: (r) => <span className="font-medium">{r.name}</span>, hideable: false },
    { key: "key", header: "Key", cell: (r) => <code className="text-xs">{r.key}</code> },
    { key: "locale", header: "Locale", cell: (r) => dash(r.locale) },
    { key: "subjectTemplate", header: "Subject", cell: (r) => dash(r.subjectTemplate) },
    {
      key: "isActive",
      header: "Active",
      cell: (r) => (r.isActive ? <span className="text-xs">Yes</span> : dash(null)),
    },
  ],
}

export const notificationEventTypesConfig: DomainTableConfig<NotificationEventType> = {
  key: "notification-event-types",
  title: "Event types",
  endpoint: "/system/notifications/event-types",
  source: "collection",
  searchable: true,
  canCreate: false,
  canEdit: false,
  canDelete: false,
  selectable: false,
  emptyMessage: "No event types registered.",
  columns: [
    { key: "name", header: "Name", cell: (r) => <span className="font-medium">{r.name}</span>, hideable: false },
    { key: "key", header: "Key", cell: (r) => <code className="text-xs">{r.key}</code> },
    { key: "category", header: "Category", cell: (r) => dash(r.category) },
    {
      key: "isMandatory",
      header: "Mandatory",
      cell: (r) => (r.isMandatory ? <span className="text-xs">Yes</span> : dash(null)),
    },
  ],
}

/**
 * Suppressed addresses.
 *
 * Two traps in one small endpoint, both handled here:
 *
 * 1. DELETE takes the EMAIL, not the row id — hence `deleteKey`.
 * 2. The list slices server-side (`page`/`limit`) and returns a naked array
 *    with NO total, so the client cannot know whether there is a page 2.
 *    Treated as a collection, and the footnote says so when the response
 *    comes back exactly full rather than reporting a count it does not have.
 */
export const suppressionsConfig: DomainTableConfig<Suppression> = {
  // No `GET /:id` on this endpoint (verified live) — seed from the row.
  noItemEndpoint: true,
  key: "suppressions",
  title: "Suppressions",
  endpoint: "/system/notifications/suppressions",
  source: "collection",
  searchable: true,
  canCreate: true,
  canEdit: false,
  canDelete: true,
  deleteKey: (r) => r.email,
  permissions: { create: "notification.manage", delete: "notification.manage" },
  emptyMessage: "No suppressed addresses.",
  footnote: ({ total }) =>
    total >= 100 ? (
      <p className="px-1 pt-2 text-xs text-muted-foreground">
        Showing the first 100 — this endpoint does not report a total, so there may be more.
      </p>
    ) : null,
  columns: [
    { key: "email", header: "Address", cell: (r) => <span className="font-medium">{r.email}</span>, hideable: false },
    {
      key: "reason",
      header: "Reason",
      cell: (r) => <StatusBadge value={r.reason} map={SUPPRESSION_STYLES} />,
    },
    { key: "eventTypeId", header: "Event", cell: (r) => <SuppressionEvent id={r.eventTypeId} /> },
    { key: "source", header: "Source", cell: (r) => dash(r.source) },
    { key: "expiresAt", header: "Expires", cell: (r) => <DateCell value={r.expiresAt} /> },
    { key: "note", header: "Note", cell: (r) => dash(r.note) },
    { key: "createdAt", header: "Added", cell: (r) => <TimeCell value={r.createdAt} /> },
  ],
}

export const notificationsDomain: DomainSpec = {
  key: "notifications",
  label: "Notifications",
  icon: BellIcon,
  sections: [
    {
      key: "inbox",
      label: "Inbox",
      body: {
        kind: "table",
        config: notificationsConfig,
        titleOf: (r: Notification) => r.subject,
        useExtras: useNotificationExtras,
      },
    },
    {
      key: "preferences",
      label: "Preferences",
      hint: "Changes save as you make them. Required notifications cannot be turned off.",
      body: {
        kind: "table",
        config: notificationPreferencesConfig,
        titleOf: (r: NotificationPreference) => r.name,
        // One mutation instance for every editable cell in the table.
        wrapper: PreferenceProvider,
      },
    },
    {
      key: "templates",
      label: "Templates",
      secondary: true,
      roles: ["admin"],
      body: {
        kind: "table",
        config: notificationTemplatesConfig,
        titleOf: (r: NotificationTemplate) => r.name,
      },
    },
    {
      key: "suppressions",
      label: "Suppressions",
      secondary: true,
      roles: ["admin"],
      body: {
        kind: "table",
        config: suppressionsConfig,
        titleOf: (r: Suppression) => r.email,
        // The Event column is a foreign key. The wrapper resolves the lookup
        // once for the whole table instead of once per cell.
        wrapper: SuppressionLookupProvider,
      },
    },
    {
      key: "event-types",
      label: "Event types",
      secondary: true,
      roles: ["admin"],
      body: {
        kind: "table",
        config: notificationEventTypesConfig,
        titleOf: (r: NotificationEventType) => r.name,
      },
    },
  ],
}
