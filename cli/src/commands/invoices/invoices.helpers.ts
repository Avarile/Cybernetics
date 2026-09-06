import { schemas } from '../../generated/schemas';

/**
 * `GET /invoices/{id}` (by way of `.detail`) and list-row shape
 * (`InvoiceRow` in api/src/infrastructure/database/schema/finance.schema.ts)
 * — a raw DB row, same reasoning as tasks/finance transactions (see
 * finance.helpers.ts's TransactionRecord doc comment).
 *
 * `subtotal`, `taxTotal`, `total` and `amountPaid` are `numeric` columns —
 * Drizzle returns them as strings, and they stay strings end to end here,
 * never parsed, summed or reformatted.
 */
export interface InvoiceRecord {
  id: string;
  number: string;
  contactId: string | null;
  companyId: string | null;
  projectId: string | null;
  issueDate: string;
  dueDate: string;
  currency: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  status: string;
  billToSnapshot: BillToSnapshot;
  notes: string | null;
  terms: string | null;
  pdfFileId: string | null;
  sentAt: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
  deletedAt: string | null;
}

/**
 * The bill-to details as they stood at creation, frozen onto the invoice
 * (`InvoiceService.billToSnapshot` — see invoice.service.ts). Present on
 * every list row, not just `get`, because it comes from a plain `select()`
 * with no projection — which is what lets `CONTACT` render a real name
 * without an extra lookup (see invoices-ls.command.ts).
 */
export interface BillToSnapshot {
  kind?: 'contact' | 'company';
  name?: string;
  email?: string;
  address?: unknown;
  taxNumber?: string;
}

/** `GET /invoices` response envelope. */
export interface InvoiceListEnvelope {
  data: InvoiceRecord[];
  total: number;
  page: number;
  limit: number;
}

/** One row of `GET /invoices/{id}` → `lineItems`. */
export interface InvoiceLineItemRecord {
  id: string;
  invoiceId: string;
  description: string;
  quantity: string;
  unit: string | null;
  unitPrice: string;
  taxRatePct: string;
  amount: string;
  taxAmount: string;
  total: string;
  taskId: string | null;
  projectId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
  deletedAt: string | null;
}

/** One row of `GET /invoices/{id}` → `payments`. */
export interface PaymentRecord {
  id: string;
  invoiceId: string;
  transactionId: string | null;
  amount: string;
  currency: string;
  paidAt: string;
  method: string;
  reference: string | null;
  recordedBy: string | null;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
  deletedAt: string | null;
}

/**
 * `GET /invoices/{id}` response shape — NOT a bare `InvoiceRecord`.
 * `InvoiceController.get` calls `InvoiceService.detail`, which bundles the
 * header row with its line items and payments in one response (confirmed
 * against invoice.service.ts's `detail()` and invoice.controller.ts).
 */
export interface InvoiceDetail {
  invoice: InvoiceRecord;
  lineItems: InvoiceLineItemRecord[];
  payments: PaymentRecord[];
}

/** `CreateInvoiceDto`'s schema, unmodified. */
export const INVOICE_CREATE_SCHEMA: unknown = schemas['CreateInvoiceDto'];
/** `AddLineItemDto`'s schema, unmodified. */
export const INVOICE_LINE_CREATE_SCHEMA: unknown = schemas['AddLineItemDto'];
/** `BillTimeDto`'s schema, unmodified. */
export const INVOICE_BILL_TIME_SCHEMA: unknown = schemas['BillTimeDto'];

export const INVOICE_TEMPLATE_HEADER = [
  'issueDate / dueDate are dates: YYYY-MM-DD.',
  'Provide a contactId or a companyId — that rule is enforced server-side and does not appear ' +
    'in this schema, so a violation reopens this buffer annotated with the issue.',
  "Everything below the closing --- becomes the invoice's notes.",
];

export const INVOICE_LINE_TEMPLATE_HEADER = [
  'quantity / unitPrice / taxRatePct are decimal strings, never bare numbers.',
];

export const INVOICE_BILL_TIME_TEMPLATE_HEADER = [
  'timeEntryIds is a YAML array of time-entry UUIDs (flag mode: --time-entries, comma-separated).',
  'unitPrice / taxRatePct are decimal strings, never bare numbers.',
];

/** See `core/render/pagination-note.ts` for the shared implementation this re-exports. */
export { morePagesNote } from '../../core/render/pagination-note';

/**
 * `CONTACT` column value for `invoices ls`/`get`: `InvoiceRow` carries only
 * `contactId`/`companyId` — no name — but `billToSnapshot` is real,
 * already-denormalized payload data (not an id), frozen at creation, so it
 * renders correctly even for a contact deleted or renamed since. Preferred
 * over resolving `contactId` live: that would need `ContactController_get`
 * per row and would drift from what the invoice actually says it billed.
 */
export function billToName(snapshot: BillToSnapshot): string {
  return snapshot?.name ?? '';
}
