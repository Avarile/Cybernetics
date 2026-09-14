import { UsersIcon } from "lucide-react"
import type { DomainTableConfig } from "@/components/data-table/types"
import type { DomainSpec } from "@/components/data-window/types"
import { DateCell, StatusBadge, TreeName, dash, type StatusStyle } from "./cells"

/** Mirrors `PublicContact` in `api/src/features/contacts/contact.service.ts`. */
export interface Contact {
  id: string
  displayName: string
  firstName: string | null
  lastName: string | null
  primaryEmail: string | null
  primaryPhone: string | null
  jobTitle: string | null
  companyId: string | null
  status: "active" | "inactive" | "archived" | "do_not_contact"
  source: string
  visibility: "private" | "shared"
  country: string | null
  lastContactedAt: string | null
  nextFollowUpAt: string | null
  tagIds: string[]
  createdAt: string
}

/** Mirrors the `contact_companies` row the API returns. */
export interface Company {
  id: string
  name: string
  legalName: string | null
  domain: string | null
  industry: string | null
  size: "micro" | "small" | "medium" | "large" | "enterprise" | null
  website: string | null
  phone: string | null
  country: string | null
  status: Contact["status"]
  taxNumber: string | null
}

/** A `contact_types` row. */
export interface ContactType {
  id: string
  key: string
  name: string
  description: string | null
  color: string | null
  sortOrder: number
  isSystem: boolean
}

/** A `contact_categories` row — a materialised-path tree. */
export interface ContactCategory {
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

/** From `CONTACT_STATUSES` in `contact.dto.ts`. */
const STATUSES = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "archived", label: "Archived" },
  { value: "do_not_contact", label: "Do not contact" },
]

const STATUS_STYLES: Record<string, StatusStyle> = {
  active: { label: "Active", variant: "default" },
  inactive: { label: "Inactive", variant: "secondary" },
  archived: { label: "Archived", variant: "secondary" },
  do_not_contact: { label: "Do not contact", variant: "destructive" },
}

const SIZES = [
  { value: "micro", label: "Micro" },
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "enterprise", label: "Enterprise" },
]

export const contactsConfig: DomainTableConfig<Contact> = {
  key: "contacts",
  title: "Contacts",
  endpoint: "/contacts",
  searchable: true,
  canCreate: true,
  canEdit: true,
  canDelete: true,
  permissions: {
    create: "contact.create",
    update: "contact.update",
    delete: "contact.delete",
  },
  emptyMessage: "No contacts match this view.",
  tabs: [
    { value: "all", label: "All", query: {} },
    { value: "active", label: "Active", query: { status: "active" } },
    { value: "archived", label: "Archived", query: { status: "archived" } },
  ],
  // Every one of these is accepted by `listContactsSchema` and none of them
  // was reachable before — the DTO declared five filters and the UI offered
  // one.
  filters: [
    { key: "status", label: "Status", options: STATUSES },
    {
      key: "companyId",
      label: "Company",
      source: { endpoint: "/companies", labelKey: "name" },
      searchable: true,
    },
    {
      key: "typeId",
      label: "Type",
      source: { endpoint: "/contact-vocabulary/types", labelKey: "name" },
    },
    {
      key: "categoryId",
      label: "Category",
      source: { endpoint: "/contact-vocabulary/categories", labelKey: "name" },
    },
    {
      key: "tagId",
      label: "Tag",
      source: { endpoint: "/tags", labelKey: "label" },
      searchable: true,
    },
  ],
  columns: [
    {
      key: "displayName",
      header: "Name",
      cell: (r) => <span className="font-medium">{r.displayName}</span>,
      hideable: false,
    },
    { key: "primaryEmail", header: "Email", cell: (r) => dash(r.primaryEmail) },
    { key: "jobTitle", header: "Title", cell: (r) => dash(r.jobTitle) },
    { key: "primaryPhone", header: "Phone", cell: (r) => dash(r.primaryPhone) },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge value={r.status} map={STATUS_STYLES} />,
    },
    {
      key: "visibility",
      header: "Visibility",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">{r.visibility}</span>
      ),
    },
    {
      key: "lastContactedAt",
      header: "Last contacted",
      cell: (r) => <DateCell value={r.lastContactedAt} />,
    },
  ],
}

export const companiesConfig: DomainTableConfig<Company> = {
  key: "companies",
  title: "Companies",
  endpoint: "/companies",
  searchable: true,
  canCreate: true,
  canEdit: true,
  canDelete: true,
  permissions: {
    create: "contact.create",
    update: "contact.update",
    delete: "contact.delete",
  },
  emptyMessage: "No companies match this view.",
  tabs: [
    { value: "all", label: "All", query: {} },
    { value: "active", label: "Active", query: { status: "active" } },
    { value: "archived", label: "Archived", query: { status: "archived" } },
  ],
  filters: [{ key: "status", label: "Status", options: STATUSES }],
  columns: [
    {
      key: "name",
      header: "Name",
      cell: (r) => <span className="font-medium">{r.name}</span>,
      hideable: false,
    },
    { key: "domain", header: "Domain", cell: (r) => dash(r.domain) },
    { key: "industry", header: "Industry", cell: (r) => dash(r.industry) },
    {
      key: "size",
      header: "Size",
      cell: (r) => dash(SIZES.find((s) => s.value === r.size)?.label ?? r.size),
    },
    { key: "country", header: "Country", cell: (r) => dash(r.country) },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge value={r.status} map={STATUS_STYLES} />,
    },
  ],
}

export const contactTypesConfig: DomainTableConfig<ContactType> = {
  // No `GET /:id` on this endpoint (verified live) — seed from the row.
  noItemEndpoint: true,
  key: "contact-types",
  title: "Contact types",
  endpoint: "/contact-vocabulary/types",
  // A bare array — no envelope, no paging.
  source: "collection",
  searchable: true,
  canCreate: true,
  canEdit: true,
  // A system row is seeded, not owned; the server refuses to remove it.
  canDelete: (r) => !r.isSystem,
  emptyMessage: "No contact types yet.",
  defaultSort: { key: "sortOrder", dir: "asc" },
  columns: [
    {
      key: "name",
      header: "Name",
      cell: (r) => (
        <span className="flex items-center gap-2 font-medium">
          {r.color && (
            <span
              aria-hidden
              className="size-2.5 rounded-full"
              style={{ backgroundColor: r.color }}
            />
          )}
          {r.name}
        </span>
      ),
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

export const contactCategoriesConfig: DomainTableConfig<ContactCategory> = {
  // No `GET /:id` on this endpoint (verified live) — seed from the row.
  noItemEndpoint: true,
  key: "contact-categories",
  title: "Contact categories",
  endpoint: "/contact-vocabulary/categories",
  source: "collection",
  searchable: true,
  canCreate: true,
  canEdit: true,
  canDelete: (r) => !r.isSystem,
  emptyMessage: "No categories yet.",
  // Sorted by path so the materialised-path tree reads as a tree inside a
  // flat table; the Name cell indents by depth to match.
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

export const contactsDomain: DomainSpec = {
  key: "contacts",
  label: "Contacts",
  icon: UsersIcon,
  sections: [
    {
      key: "people",
      label: "People",
      body: { kind: "table", config: contactsConfig, titleOf: (r: Contact) => r.displayName },
    },
    {
      key: "companies",
      label: "Companies",
      body: { kind: "table", config: companiesConfig, titleOf: (r: Company) => r.name },
    },
    {
      key: "types",
      label: "Types",
      secondary: true,
      // Writes are admin-only (`@Roles('admin')` on the vocabulary controller),
      // but reads are not — a user needs to see the type a contact carries.
      hint: "Reference data. Only an administrator can change it.",
      body: {
        kind: "table",
        config: contactTypesConfig,
        titleOf: (r: ContactType) => r.name,
      },
    },
    {
      key: "categories",
      label: "Categories",
      secondary: true,
      hint: "Reference data. Only an administrator can change it.",
      body: {
        kind: "table",
        config: contactCategoriesConfig,
        titleOf: (r: ContactCategory) => r.name,
      },
    },
  ],
}
