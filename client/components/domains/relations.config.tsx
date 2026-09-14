import type { DomainTableConfig } from "@/components/data-table/types"
import { DateCell, Money, TimeCell, dash } from "./cells"

/**
 * Per-record collections, as table configs.
 *
 * Each takes the parent id because its endpoint embeds it — these resources
 * do not exist without a parent and are not reachable from any list. All of
 * them are bare arrays, hence `source: "collection"`.
 */

export interface InvoiceLine {
  id: string
  description: string
  quantity: string
  unit: string | null
  unitPrice: string
  taxRatePct: string
  amount: string
  taxAmount: string
  total: string
  sortOrder: number
}

export interface Payment {
  id: string
  amount: string
  currency: string
  paidAt: string
  method: string
  reference: string | null
}

export interface Channel {
  id: string
  kind: string
  value: string
  label: string | null
  isPrimary: boolean
}

export interface Relationship {
  id: string
  toContactId: string
  type: string
  strength: string | null
  since: string | null
  note: string | null
}

export interface Interaction {
  id: string
  kind: string
  occurredAt: string
  subject: string | null
  direction: string | null
  durationMinutes: number | null
}

export interface Grant {
  id: string
  granteeType: "user" | "role" | "authenticated"
  granteeUserId: string | null
  granteeRoleId: string | null
  permission: "read" | "comment" | "write" | "manage"
  expiresAt: string | null
}

export interface TaskDependency {
  id: string
  predecessorTaskId: string
  type: string
  lagDays: number
}

/**
 * Invoice lines and payments are INLINE.
 *
 * `GET /invoices/:id/lines` and `/payments` do not exist — verified live,
 * both 404. The only way to read either is `GET /invoices/:id`, which
 * answers `{ invoice, lineItems, payments }`. So these configs carry an
 * endpoint for writes (POST/DELETE do exist) and take their rows from the
 * parent record.
 */
export const invoiceLinesConfig = (invoiceId: string): DomainTableConfig<InvoiceLine> => ({
  key: "invoice-line",
  title: "Lines",
  endpoint: `/invoices/${invoiceId}/lines`,
  source: "inline",
  noItemEndpoint: true,
  canCreate: true,
  canEdit: false,
  canDelete: true,
  selectable: false,
  emptyMessage: "No lines on this invoice yet.",
  defaultSort: { key: "sortOrder", dir: "asc" },
  columns: [
    {
      key: "description",
      header: "Description",
      cell: (r) => <span className="font-medium">{r.description}</span>,
      hideable: false,
    },
    { key: "quantity", header: "Qty", numeric: true, cell: (r) => <span className="tabular-nums">{r.quantity}</span> },
    { key: "unit", header: "Unit", cell: (r) => dash(r.unit) },
    { key: "unitPrice", header: "Unit price", numeric: true, cell: (r) => <Money amount={r.unitPrice} /> },
    { key: "taxRatePct", header: "Tax %", numeric: true, cell: (r) => <span className="tabular-nums">{r.taxRatePct}</span> },
    { key: "total", header: "Total", numeric: true, cell: (r) => <Money amount={r.total} /> },
  ],
})

export const invoicePaymentsConfig = (invoiceId: string): DomainTableConfig<Payment> => ({
  key: "payment",
  title: "Payments",
  endpoint: `/invoices/${invoiceId}/payments`,
  source: "inline",
  noItemEndpoint: true,
  canCreate: true,
  canEdit: false,
  canDelete: false,
  selectable: false,
  emptyMessage: "No payments recorded.",
  columns: [
    { key: "paidAt", header: "Paid", cell: (r) => <TimeCell value={r.paidAt} />, hideable: false },
    { key: "amount", header: "Amount", numeric: true, cell: (r) => <Money amount={r.amount} currency={r.currency} /> },
    { key: "method", header: "Method", cell: (r) => dash(r.method) },
    { key: "reference", header: "Reference", cell: (r) => dash(r.reference) },
  ],
})

export const contactChannelsConfig = (contactId: string): DomainTableConfig<Channel> => ({
  key: "contact-channels",
  noItemEndpoint: true,
  title: "Channels",
  endpoint: `/contacts/${contactId}/channels`,
  source: "collection",
  canCreate: true,
  canEdit: false,
  canDelete: true,
  selectable: false,
  emptyMessage: "No channels for this contact.",
  columns: [
    { key: "value", header: "Value", cell: (r) => <span className="font-medium">{r.value}</span>, hideable: false },
    { key: "kind", header: "Kind", cell: (r) => dash(r.kind) },
    { key: "label", header: "Label", cell: (r) => dash(r.label) },
    {
      key: "isPrimary",
      header: "Primary",
      cell: (r) => (r.isPrimary ? <span className="text-xs">Yes</span> : dash(null)),
    },
  ],
})

export const contactRelationshipsConfig = (contactId: string): DomainTableConfig<Relationship> => ({
  key: "contact-relationships",
  noItemEndpoint: true,
  title: "Relationships",
  endpoint: `/contacts/${contactId}/relationships`,
  source: "collection",
  canCreate: true,
  canEdit: false,
  canDelete: true,
  selectable: false,
  emptyMessage: "No relationships recorded.",
  columns: [
    { key: "type", header: "Type", cell: (r) => <span className="font-medium">{r.type}</span>, hideable: false },
    { key: "strength", header: "Strength", cell: (r) => dash(r.strength) },
    { key: "since", header: "Since", cell: (r) => <DateCell value={r.since} /> },
    { key: "note", header: "Note", cell: (r) => dash(r.note) },
  ],
})

export const contactInteractionsConfig = (contactId: string): DomainTableConfig<Interaction> => ({
  key: "contact-interactions",
  noItemEndpoint: true,
  title: "Interactions",
  // The one relation that is PAGED — listInteractionsSchema takes page/limit.
  endpoint: `/contacts/${contactId}/interactions`,
  canCreate: true,
  canEdit: false,
  canDelete: true,
  selectable: false,
  emptyMessage: "No interactions logged.",
  columns: [
    { key: "occurredAt", header: "When", cell: (r) => <TimeCell value={r.occurredAt} />, hideable: false },
    { key: "kind", header: "Kind", cell: (r) => dash(r.kind) },
    { key: "subject", header: "Subject", cell: (r) => dash(r.subject) },
    { key: "direction", header: "Direction", cell: (r) => dash(r.direction) },
    {
      key: "durationMinutes",
      header: "Duration",
      numeric: true,
      cell: (r) => (r.durationMinutes == null ? dash(null) : `${r.durationMinutes}m`),
    },
  ],
})

export const knowledgeGrantsConfig = (knowledgeId: string): DomainTableConfig<Grant> => ({
  key: "knowledge-grants",
  noItemEndpoint: true,
  title: "Access",
  endpoint: `/knowledge/${knowledgeId}/grants`,
  source: "collection",
  canCreate: true,
  canEdit: false,
  canDelete: true,
  selectable: false,
  emptyMessage: "No explicit grants — only the owner can see this.",
  columns: [
    { key: "granteeType", header: "Grantee", cell: (r) => <span className="font-medium">{r.granteeType}</span>, hideable: false },
    { key: "permission", header: "Permission", cell: (r) => dash(r.permission) },
    { key: "expiresAt", header: "Expires", cell: (r) => <DateCell value={r.expiresAt} /> },
  ],
})

export const taskDependenciesConfig = (taskId: string): DomainTableConfig<TaskDependency> => ({
  key: "task-dependencies",
  noItemEndpoint: true,
  title: "Depends on",
  endpoint: `/tasks/${taskId}/dependencies`,
  source: "collection",
  canCreate: true,
  canEdit: false,
  canDelete: true,
  selectable: false,
  emptyMessage: "No dependencies.",
  columns: [
    { key: "type", header: "Type", cell: (r) => <span className="font-medium">{r.type}</span>, hideable: false },
    { key: "lagDays", header: "Lag", numeric: true, cell: (r) => `${r.lagDays}d` },
  ],
})
