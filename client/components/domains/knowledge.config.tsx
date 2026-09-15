import { BookOpenIcon } from "lucide-react"
import type { DomainTableConfig } from "@/components/data-table/types"
import type { DomainSpec } from "@/components/data-window/types"
import { DateCell, StatusBadge, TimeCell, TreeName, dash, type StatusStyle } from "./cells"
import { useKnowledgeExtras } from "./knowledge-actions"

/** Mirrors `PublicKnowledge` in `api/src/features/knowledge/knowledge.service.ts`. */
export interface Knowledge {
  id: string
  title: string
  slug: string
  summary: string | null
  body: string | null
  format: "markdown" | "html" | "plain" | "link" | "file"
  status: "draft" | "in_review" | "published" | "archived" | "deprecated"
  visibility: "private" | "restricted" | "internal"
  version: number
  typeId: string | null
  categoryId: string | null
  ownerUserId: string | null
  sourceUrl: string | null
  language: string
  publishedAt: string | null
  reviewDueAt: string | null
  tagIds: string[]
  /** What the asking principal may do. The server says so explicitly. */
  access: "none" | "read" | "comment" | "write" | "manage"
  updatedAt: string
}

export interface KnowledgeType {
  id: string
  key: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  defaultReviewIntervalDays: number | null
  sortOrder: number
  isSystem: boolean
}

export interface KnowledgeCategory {
  id: string
  key: string
  name: string
  description: string | null
  parentId: string | null
  path: string
  depth: number
  sortOrder: number
  isSystem: boolean
}

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "in_review", label: "In review" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
  { value: "deprecated", label: "Deprecated" },
]

const STATUS_STYLES: Record<string, StatusStyle> = {
  draft: { label: "Draft", variant: "outline" },
  in_review: { label: "In review", variant: "secondary" },
  published: { label: "Published", variant: "default" },
  archived: { label: "Archived", variant: "secondary" },
  deprecated: { label: "Deprecated", variant: "destructive" },
}

const canWrite = (r: Knowledge) => r.access === "write" || r.access === "manage"

export const knowledgeConfig: DomainTableConfig<Knowledge> = {
  key: "knowledge",
  title: "Articles",
  endpoint: "/knowledge",
  searchable: true,
  canCreate: true,
  // Per row: the server already resolved what this principal may do to it.
  canEdit: canWrite,
  canDelete: (r) => r.access === "manage",
  permissions: {
    create: "knowledge.create",
    update: "knowledge.update",
    delete: "knowledge.delete",
  },
  emptyMessage: "No articles match this view.",
  tabs: [
    { value: "all", label: "All", query: {} },
    { value: "draft", label: "Draft", query: { status: "draft" } },
    { value: "in_review", label: "In review", query: { status: "in_review" } },
    { value: "published", label: "Published", query: { status: "published" } },
    { value: "archived", label: "Archived", query: { status: "archived" } },
  ],
  filters: [
    { key: "status", label: "Status", options: STATUSES },
    {
      key: "typeId",
      label: "Type",
      source: { endpoint: "/knowledge-vocabulary/types", labelKey: "name" },
    },
    {
      key: "categoryId",
      label: "Category",
      source: { endpoint: "/knowledge-vocabulary/categories", labelKey: "name" },
    },
    { key: "tagId", label: "Tag", source: { endpoint: "/tags", labelKey: "label" }, searchable: true },
  ],
  /**
   * This domain pages in SQL and THEN drops rows the principal cannot see,
   * so a page can come back short of its limit while later pages still
   * exist. The count is per-page and exact; a collection-wide "N hidden"
   * is not available and must not be invented.
   */
  footnote: ({ hiddenOnPage }) =>
    hiddenOnPage ? (
      <p className="px-1 pt-2 text-xs text-muted-foreground">
        {hiddenOnPage} record{hiddenOnPage === 1 ? " on this page is" : "s on this page are"} not
        visible to you.
      </p>
    ) : null,
  columns: [
    {
      key: "title",
      header: "Title",
      cell: (r) => <span className="font-medium">{r.title}</span>,
      hideable: false,
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge value={r.status} map={STATUS_STYLES} />,
    },
    {
      key: "visibility",
      header: "Visibility",
      cell: (r) => <span className="text-xs text-muted-foreground">{r.visibility}</span>,
    },
    { key: "version", header: "Version", cell: (r) => `v${r.version}`, numeric: true },
    { key: "language", header: "Language", cell: (r) => dash(r.language) },
    {
      key: "reviewDueAt",
      header: "Review due",
      cell: (r) => <DateCell value={r.reviewDueAt} />,
    },
    { key: "updatedAt", header: "Updated", cell: (r) => <TimeCell value={r.updatedAt} /> },
  ],
}

export const knowledgeTypesConfig: DomainTableConfig<KnowledgeType> = {
  // No `GET /:id` on this endpoint (verified live) — seed from the row.
  noItemEndpoint: true,
  key: "knowledge-types",
  title: "Knowledge types",
  endpoint: "/knowledge-vocabulary/types",
  source: "collection",
  searchable: true,
  canCreate: true,
  canEdit: true,
  canDelete: (r) => !r.isSystem,
  emptyMessage: "No knowledge types yet.",
  defaultSort: { key: "sortOrder", dir: "asc" },
  columns: [
    {
      key: "name",
      header: "Name",
      cell: (r) => <span className="font-medium">{r.name}</span>,
      hideable: false,
    },
    {
      key: "key",
      header: "Key",
      cell: (r) => <code className="text-xs text-muted-foreground">{r.key}</code>,
    },
    {
      key: "defaultReviewIntervalDays",
      header: "Review every",
      cell: (r) =>
        r.defaultReviewIntervalDays == null ? dash(null) : `${r.defaultReviewIntervalDays}d`,
      numeric: true,
    },
    { key: "description", header: "Description", cell: (r) => dash(r.description) },
    { key: "sortOrder", header: "Order", cell: (r) => r.sortOrder, numeric: true },
  ],
}

export const knowledgeCategoriesConfig: DomainTableConfig<KnowledgeCategory> = {
  // No `GET /:id` on this endpoint (verified live) — seed from the row.
  noItemEndpoint: true,
  key: "knowledge-categories",
  title: "Knowledge categories",
  endpoint: "/knowledge-vocabulary/categories",
  source: "collection",
  searchable: true,
  canCreate: true,
  canEdit: true,
  canDelete: (r) => !r.isSystem,
  emptyMessage: "No categories yet.",
  defaultSort: { key: "path", dir: "asc" },
  columns: [
    {
      key: "name",
      header: "Name",
      cell: (r) => <TreeName depth={r.depth} name={r.name} />,
      hideable: false,
    },
    {
      key: "key",
      header: "Key",
      cell: (r) => <code className="text-xs text-muted-foreground">{r.key}</code>,
    },
    { key: "description", header: "Description", cell: (r) => dash(r.description) },
    { key: "sortOrder", header: "Order", cell: (r) => r.sortOrder, numeric: true },
  ],
}

export const knowledgeDomain: DomainSpec = {
  key: "knowledge",
  label: "Knowledge",
  icon: BookOpenIcon,
  sections: [
    {
      key: "articles",
      label: "Articles",
      body: {
        kind: "table",
        config: knowledgeConfig,
        titleOf: (r: Knowledge) => r.title,
        useExtras: useKnowledgeExtras,
      },
    },
    {
      key: "types",
      label: "Types",
      hint: "Reference data. Only an administrator can change it.",
      body: {
        kind: "table",
        config: knowledgeTypesConfig,
        titleOf: (r: KnowledgeType) => r.name,
      },
    },
    {
      key: "categories",
      label: "Categories",
      hint: "Reference data. Only an administrator can change it.",
      body: {
        kind: "table",
        config: knowledgeCategoriesConfig,
        titleOf: (r: KnowledgeCategory) => r.name,
      },
    },
  ],
}
