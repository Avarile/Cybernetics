import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import type { UserRole } from "@/lib/api/types"
import type { DomainTableConfig, HasId } from "@/components/data-table/types"

export type DomainKey =
  | "contacts"
  | "finance"
  | "knowledge"
  | "notifications"
  | "projects"
  | "files"
  | "profile"

/**
 * A section that needs a parent id before it can load anything.
 *
 * `GET /projects/:id/milestones` has no unscoped form — without a project there
 * is nothing to request. Such a section renders a picker and stays silent until
 * one is chosen, rather than firing a request it knows will fail.
 */
export interface SectionScope {
  /** Path segment the parent fills: `/projects/{id}/milestones`. */
  param: string
  /** Collection the picker reads its options from. */
  from: string
  labelKey: string
  placeholder: string
}

/**
 * Config fragments that can only be built from hooks.
 *
 * A config is otherwise a static object, which is what keeps a domain
 * declarative. Two things genuinely cannot be: the Files dropzone is bound to
 * upload state, and its Download action is bound to the API client. Rather
 * than make every domain author a hook for the sake of two, sections declare
 * an optional one and the section component calls it.
 */
export type TableExtras<T extends HasId> = () => Partial<
  Pick<DomainTableConfig<T>, "toolbarExtra" | "rowActions">
>

export type SectionBody<T extends HasId = HasId> =
  | {
      kind: "table"
      config: DomainTableConfig<T>
      /** Row → window title. Without it a record window is titled by its uuid. */
      titleOf: (row: T) => string
      useExtras?: TableExtras<T>
      /**
       * Wraps the table in a provider.
       *
       * For a table whose cells are editable: every cell needs the SAME
       * `useCellMutation` instance, or two in-flight edits each hold their
       * own cache snapshot and one rollback clobbers the other. A `cell()`
       * callback cannot call hooks, so context is the only way to reach one.
       */
      wrapper?: React.ComponentType<{ children: ReactNode }>
    }
  /** Scoped table: `config` is a factory, because the endpoint embeds the id. */
  | {
      kind: "scoped-table"
      scope: SectionScope
      config: (parentId: string) => DomainTableConfig<T>
      titleOf: (row: T) => string
      useExtras?: TableExtras<T>
      /**
       * Wraps the table in a provider.
       *
       * For a table whose cells are editable: every cell needs the SAME
       * `useCellMutation` instance, or two in-flight edits each hold their
       * own cache snapshot and one rollback clobbers the other. A `cell()`
       * callback cannot call hooks, so context is the only way to reach one.
       */
      wrapper?: React.ComponentType<{ children: ReactNode }>
    }
  /** A resource of one — `/me/profile`. `spec` keys into RECORD_FORMS. */
  | { kind: "form"; endpoint: string; spec: string }
  /** Reports, the account card: an aggregate, not a row set. */
  | { kind: "custom"; render: () => ReactNode }

export interface SectionSpec {
  /** Stable — it is persisted in window props. */
  key: string
  label: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: SectionBody<any>
  /**
   * Hidden entirely for principals outside this list. Omit ⇒ everyone.
   *
   * Role, not permission: no endpoint tells a client its own effective
   * permissions (`/authorization/users/:id/effective` is itself admin-gated),
   * so role is the only honest input. This is not a security control — the
   * server still enforces. It exists so an ordinary user is not shown five
   * tabs that all render 403.
   */
  roles?: UserRole[]
  /** Demoted into the tab row's "⋯" overflow. Reference/vocabulary data. */
  secondary?: boolean
  /** One line under the breadcrumb when the section needs explaining. */
  hint?: string
}

export interface DomainSpec {
  key: DomainKey
  label: string
  icon: LucideIcon
  sections: SectionSpec[]
  roles?: UserRole[]
}
