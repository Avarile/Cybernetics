import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

/** A row the generic table can render: anything with a stable string id. */
export interface HasId {
  id: string
}

export interface ColumnSpec<T> {
  /** Matches the row key it reads, unless `cell` supplies its own. */
  key: string
  header: string
  cell: (row: T) => ReactNode
  /** Column can be hidden from the Columns menu. Default true. */
  hideable?: boolean
  /** Server-side sort key. Omit to make the column unsortable. */
  sortKey?: string
  /** Right-aligned and tabular. Money and counts, so digits line up. */
  numeric?: boolean
  className?: string
}

export interface FilterSpec {
  /** Query-param name sent to the API. */
  key: string
  label: string
  /** Static enum options — from a DTO's `z.enum`. */
  options?: { value: string; label: string }[]
  /**
   * …or options fetched from a collection endpoint, for a filter over a
   * foreign key (account, project, contact). Exactly one of `options` and
   * `source`.
   */
  source?: { endpoint: string; valueKey?: string; labelKey: string }
  /** Above ~20 options a Select is unusable; render a Combobox instead. */
  searchable?: boolean
}

export interface TabSpec {
  value: string
  label: string
  /** Extra query params applied while this tab is active. */
  query: Record<string, string>
  /** Shown as a count badge when the tab is active. */
  showCount?: boolean
}

export interface RowAction<T> {
  label: string
  icon?: LucideIcon
  onSelect: (row: T) => void
  destructive?: boolean
  /** Hidden entirely when this returns false — a permanently disabled item is
   *  noise. */
  visible?: (row: T) => boolean
}

/**
 * Everything the generic table needs to render one domain.
 *
 * A domain is declared, not implemented: adding Knowledge or Projects is a new
 * config object, not a new component.
 */
export interface DomainTableConfig<T extends HasId> {
  key: string
  title: string
  /** Paginated list endpoint, e.g. `/contacts`. */
  endpoint: string
  columns: ColumnSpec<T>[]
  tabs?: TabSpec[]
  filters?: FilterSpec[]
  /** Adds a search box wired to the `search` query param. */
  searchable?: boolean
  /** Row actions beyond the built-in Edit/Delete. */
  rowActions?: RowAction<T>[]
  /** Backend `@RequirePermission` keys. Actions are hidden without them. */
  permissions?: { create?: string; update?: string; delete?: string }
  /**
   * Row identity, when the endpoint does not return an `id`.
   *
   * `/notifications/preferences` composes its rows from event types and
   * saved settings and keys them on `eventKey` — there is no row to have an
   * id. Without this the table renders every row under `key={undefined}`.
   */
  rowId?: (row: T) => string
  /**
   * The path segment DELETE uses, when it is not the row id.
   *
   * `DELETE /system/notifications/suppressions/:email`
   * `DELETE /projects/:id/members/:userId`
   * `DELETE /me/preferences/:key`
   *
   * Defaults to `row.id`, which is right for every other domain.
   */
  deleteKey?: (row: T) => string
  /** Omit to make the domain read-only. */
  canCreate?: boolean
  /**
   * Per-row, not merely per-domain.
   *
   * `PublicProject.access` and `PublicKnowledge.access` say what THIS
   * principal may do to THIS row — the server telling the client so it need
   * not guess. A viewer must not be offered Edit on a project they can only
   * read, and a time entry already on an invoice must not be editable at all.
   */
  canEdit?: boolean | ((row: T) => boolean)
  canDelete?: boolean | ((row: T) => boolean)
  /** Rendered above the table — e.g. the Files dropzone. */
  toolbarExtra?: ReactNode
  emptyMessage?: string
  /**
   * "paged"      — `{ data | items | rows, total }`; the server pages it.
   * "collection" — a bare JSON array; page, filter and search client-side.
   * "inline"     — rows arrive as a prop, from a parent record that already
   *                holds them. `GET /invoices/:id` returns its own lineItems
   *                and payments, and there is no list route for either.
   *
   * Forced by the backend, not chosen.
   */
  source?: "paged" | "collection" | "inline"
  /**
   * The endpoint has a list route but no `GET /:id`.
   *
   * Verified live against eleven of them — every vocabulary list, budgets,
   * accounts, recurring, fx-rates, suppressions, time entries and project
   * members. A record window opened against one 404s on load, so those are
   * seeded from the row already in hand instead of fetched.
   */
  noItemEndpoint?: boolean
  /** Checkbox column and bulk actions. False where nothing bulk-acts on a row
   *  — there is no "delete 3 notification preferences". */
  selectable?: boolean
  /** Sent as `sort=&order=` on first load. */
  defaultSort?: { key: string; dir: "asc" | "desc" }
  /** Shown under the table — e.g. knowledge's post-ACL short pages. */
  footnote?: (page: { total: number; hiddenOnPage?: number }) => ReactNode
}
