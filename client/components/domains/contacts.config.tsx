import { Badge } from "@/components/ui/badge"
import type { DomainTableConfig } from "@/components/data-table/types"

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

/** From `CONTACT_STATUSES` in `contact.dto.ts`. */
const STATUSES = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "archived", label: "Archived" },
  { value: "do_not_contact", label: "Do not contact" },
]

const STATUS_VARIANT: Record<Contact["status"], "default" | "secondary" | "destructive"> = {
  active: "default",
  inactive: "secondary",
  archived: "secondary",
  do_not_contact: "destructive",
}

function dash(v: string | null) {
  return v ?? <span className="text-muted-foreground">—</span>
}

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
  filters: [{ key: "status", label: "Status", options: STATUSES }],
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
      cell: (r) => (
        <Badge variant={STATUS_VARIANT[r.status]} className="text-xs">
          {STATUSES.find((s) => s.value === r.status)?.label ?? r.status}
        </Badge>
      ),
    },
    {
      key: "visibility",
      header: "Visibility",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">{r.visibility}</span>
      ),
    },
  ],
}
