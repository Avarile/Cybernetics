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
  className?: string
}

export interface FilterSpec {
  /** Query-param name sent to the API. */
  key: string
  label: string
  options: { value: string; label: string }[]
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
  /** Omit to make the domain read-only. */
  canCreate?: boolean
  canEdit?: boolean
  canDelete?: boolean
  /** Rendered above the table — e.g. the Files dropzone. */
  toolbarExtra?: ReactNode
  emptyMessage?: string
}
