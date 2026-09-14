import {
  invoiceLinesConfig,
  invoicePaymentsConfig,
} from "@/components/domains/relations.config"
import { omitBlank, type RecordFormSpec } from "../record-form-spec"

/** `amount` in finance.dto.ts: a decimal string with at most four places. */
const POSITIVE_AMOUNT = /^\d{1,16}(\.\d{1,4})?$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const KIND_OPTIONS = [
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
  { value: "transfer", label: "Transfer" },
]

function requireAmount(v: string | undefined, label: string): string | null {
  if (!v?.trim()) return `${label} is required`
  if (!POSITIVE_AMOUNT.test(v.trim())) return `${label} must be a positive decimal, up to 4 places`
  return null
}

function requireDate(v: string | undefined, label: string): string | null {
  if (!v?.trim()) return `${label} is required`
  if (!ISO_DATE.test(v.trim())) return `${label} must be a date`
  return null
}

export const FINANCE_FORMS: Record<string, RecordFormSpec> = {
  // Mirrors createTransactionSchema, including its superRefine.
  transactions: {
    fields: [
      { key: "kind", label: "Kind", kind: "select", options: KIND_OPTIONS, required: true },
      { key: "occurredOn", label: "Date", kind: "date", required: true },
      {
        key: "amount",
        label: "Amount",
        kind: "text",
        required: true,
        help: "Always positive — the kind carries the sign.",
      },
      { key: "currency", label: "Currency", kind: "text", maxLength: 3, required: true },
      { key: "accountId", label: "Account", kind: "text", required: true },
      {
        key: "counterAccountId",
        label: "To account",
        kind: "text",
        help: "Required for a transfer; the account the money moves to.",
      },
      { key: "categoryId", label: "Category", kind: "text" },
      { key: "projectId", label: "Project", kind: "text" },
      { key: "contactId", label: "Contact", kind: "text", help: "Payer for income, payee for spending." },
      { key: "description", label: "Description", kind: "text", maxLength: 500, required: true },
      { key: "reference", label: "Reference", kind: "text", maxLength: 120 },
      {
        key: "status",
        label: "Status",
        kind: "select",
        createOnly: true,
        help: "Later changes go through the row menu, which enforces the legal moves.",
        options: [
          { value: "draft", label: "Draft" },
          { value: "pending", label: "Pending" },
          { value: "cleared", label: "Cleared" },
        ],
      },
    ],
    validate: (v) => {
      const amount = requireAmount(v.amount, "Amount")
      if (amount) return amount
      const date = requireDate(v.occurredOn, "Date")
      if (date) return date
      if (!v.description?.trim()) return "A transaction needs a description"
      if (!v.accountId?.trim()) return "A transaction needs an account"
      if (!v.currency?.trim()) return "A transaction needs a currency"
      // The DTO's superRefine, both branches.
      if (v.kind === "transfer" && !v.counterAccountId?.trim()) {
        return "A transfer needs the account it moves to"
      }
      if (v.counterAccountId?.trim() && v.counterAccountId.trim() === v.accountId?.trim()) {
        return "A transfer cannot target the same account"
      }
      return null
    },
    serialize: omitBlank,
  },

  accounts: {
    fields: [
      { key: "name", label: "Name", kind: "text", maxLength: 150, required: true },
      {
        key: "kind",
        label: "Kind",
        kind: "select",
        options: [
          { value: "bank", label: "Bank" },
          { value: "cash", label: "Cash" },
          { value: "credit_card", label: "Credit card" },
          { value: "receivable", label: "Receivable" },
          { value: "payable", label: "Payable" },
          { value: "other", label: "Other" },
        ],
      },
      { key: "currency", label: "Currency", kind: "text", maxLength: 3, required: true },
      { key: "openingBalance", label: "Opening balance", kind: "text" },
      { key: "institution", label: "Institution", kind: "text", maxLength: 150 },
      {
        key: "accountRef",
        label: "Reference",
        kind: "text",
        maxLength: 120,
        help: "A masked reference only — never a full account number.",
      },
    ],
    validate: (v) => {
      if (!v.name?.trim()) return "An account needs a name"
      if (!v.currency?.trim()) return "An account needs a currency"
      return null
    },
    serialize: omitBlank,
  },

  budgets: {
    fields: [
      { key: "name", label: "Name", kind: "text", maxLength: 150, required: true },
      { key: "projectId", label: "Project", kind: "text" },
      { key: "categoryId", label: "Category", kind: "text" },
      { key: "periodStart", label: "Period start", kind: "date", required: true },
      { key: "periodEnd", label: "Period end", kind: "date", required: true },
      { key: "amount", label: "Amount", kind: "text", required: true },
      { key: "currency", label: "Currency", kind: "text", maxLength: 3, required: true },
      {
        key: "alertThresholdPct",
        label: "Alert at (%)",
        kind: "text",
        help: "Defaults to 80.",
      },
    ],
    validate: (v) => {
      if (!v.name?.trim()) return "A budget needs a name"
      const amount = requireAmount(v.amount, "Amount")
      if (amount) return amount
      const start = requireDate(v.periodStart, "Period start")
      if (start) return start
      const end = requireDate(v.periodEnd, "Period end")
      if (end) return end
      // The service's own check, mirrored so the message arrives before the
      // request rather than as a field error afterwards.
      if (v.periodEnd < v.periodStart) return "The period ends before it starts"
      return null
    },
    serialize: (v) => {
      const body = omitBlank(v)
      if (body.alertThresholdPct != null) body.alertThresholdPct = Number(body.alertThresholdPct)
      return body
    },
  },

  recurring: {
    fields: [
      { key: "name", label: "Name", kind: "text", maxLength: 150, required: true },
      { key: "kind", label: "Kind", kind: "select", options: KIND_OPTIONS, required: true },
      { key: "amount", label: "Amount", kind: "text", required: true },
      { key: "currency", label: "Currency", kind: "text", maxLength: 3, required: true },
      {
        key: "frequency",
        label: "Frequency",
        kind: "select",
        required: true,
        options: [
          { value: "weekly", label: "Weekly" },
          { value: "fortnightly", label: "Fortnightly" },
          { value: "monthly", label: "Monthly" },
          { value: "quarterly", label: "Quarterly" },
          { value: "yearly", label: "Yearly" },
        ],
      },
      { key: "dayOfPeriod", label: "Day of period", kind: "text" },
      { key: "startDate", label: "Start date", kind: "date", required: true },
      { key: "endDate", label: "End date", kind: "date" },
      { key: "accountId", label: "Account", kind: "text" },
      { key: "categoryId", label: "Category", kind: "text" },
      { key: "projectId", label: "Project", kind: "text" },
      {
        key: "autoPost",
        label: "Post automatically",
        kind: "select",
        help: "No means forecast only — nothing is posted without confirmation.",
        options: [
          { value: "false", label: "No — forecast only" },
          { value: "true", label: "Yes — post automatically" },
        ],
      },
      { key: "description", label: "Description", kind: "text", maxLength: 500 },
    ],
    validate: (v) => {
      if (!v.name?.trim()) return "A schedule needs a name"
      const amount = requireAmount(v.amount, "Amount")
      if (amount) return amount
      return requireDate(v.startDate, "Start date")
    },
    serialize: (v) => {
      const body = omitBlank(v)
      if (body.autoPost != null) body.autoPost = body.autoPost === "true"
      if (body.dayOfPeriod != null) body.dayOfPeriod = Number(body.dayOfPeriod)
      return body
    },
  },

  // Mirrors createInvoiceSchema, including its refine.
  invoices: {
    fields: [
      { key: "contactId", label: "Bill to contact", kind: "text" },
      { key: "companyId", label: "Bill to company", kind: "text" },
      { key: "projectId", label: "Project", kind: "text" },
      { key: "issueDate", label: "Issue date", kind: "date", required: true },
      { key: "dueDate", label: "Due date", kind: "date", required: true },
      { key: "currency", label: "Currency", kind: "text", maxLength: 3, required: true },
      { key: "notes", label: "Notes", kind: "textarea", maxLength: 20_000 },
      { key: "terms", label: "Terms", kind: "textarea", maxLength: 20_000 },
    ],
    validate: (v) => {
      const issue = requireDate(v.issueDate, "Issue date")
      if (issue) return issue
      const due = requireDate(v.dueDate, "Due date")
      if (due) return due
      if (!v.currency?.trim()) return "An invoice needs a currency"
      if (!v.contactId?.trim() && !v.companyId?.trim()) {
        return "An invoice needs a bill-to contact or company"
      }
      return null
    },
    serialize: omitBlank,
    // `GET /invoices/:id` nests the invoice under its own key and returns
    // the two collections beside it. Without `unwrap` the form reads
    // `record.number` off the wrapper and renders blank.
    unwrap: (r) => (r.invoice as Record<string, unknown>) ?? r,
    relations: [
      {
        key: "lines",
        label: "Lines",
        config: invoiceLinesConfig,
        rows: (r) => (r.lineItems as unknown[]) ?? [],
      },
      {
        key: "payments",
        label: "Payments",
        config: invoicePaymentsConfig,
        rows: (r) => (r.payments as unknown[]) ?? [],
      },
    ],
  },

  "invoice-line": {
    fields: [
      { key: "description", label: "Description", kind: "text", maxLength: 500, required: true },
      { key: "quantity", label: "Quantity", kind: "text", required: true },
      { key: "unit", label: "Unit", kind: "text", maxLength: 40 },
      { key: "unitPrice", label: "Unit price", kind: "text", required: true },
      {
        key: "taxRatePct",
        label: "Tax rate (%)",
        kind: "text",
        help: "0 to 100.",
      },
      { key: "taskId", label: "Task", kind: "text" },
      { key: "projectId", label: "Project", kind: "text" },
    ],
    validate: (v) => {
      if (!v.description?.trim()) return "A line needs a description"
      const qty = requireAmount(v.quantity, "Quantity")
      if (qty) return qty
      const price = requireAmount(v.unitPrice, "Unit price")
      if (price) return price
      // The DTO bounds the rate by VALUE, not just digit count — a line at
      // 900% was once booked without complaint.
      if (v.taxRatePct?.trim() && Number(v.taxRatePct) > 100) return "Tax rate cannot exceed 100%"
      return null
    },
    serialize: omitBlank,
  },

  payment: {
    fields: [
      { key: "amount", label: "Amount", kind: "text", required: true },
      { key: "currency", label: "Currency", kind: "text", maxLength: 3, required: true },
      { key: "paidAt", label: "Paid on", kind: "date", required: true },
      {
        key: "method",
        label: "Method",
        kind: "select",
        options: [
          { value: "bank_transfer", label: "Bank transfer" },
          { value: "card", label: "Card" },
          { value: "cash", label: "Cash" },
          { value: "cheque", label: "Cheque" },
          { value: "other", label: "Other" },
        ],
      },
      { key: "reference", label: "Reference", kind: "text", maxLength: 120 },
      {
        key: "accountId",
        label: "Post to account",
        kind: "text",
        help: "Posts a matching ledger entry into this account.",
      },
    ],
    validate: (v) => {
      const amount = requireAmount(v.amount, "Amount")
      if (amount) return amount
      if (!v.currency?.trim()) return "A payment needs a currency"
      return requireDate(v.paidAt, "Paid on")
    },
    serialize: omitBlank,
  },

  "fx-rates": {
    fields: [
      { key: "baseCode", label: "Base", kind: "text", maxLength: 3, required: true },
      { key: "quoteCode", label: "Quote", kind: "text", maxLength: 3, required: true },
      {
        key: "rate",
        label: "Rate",
        kind: "text",
        required: true,
        help: "Up to ten decimal places — thin-traded pairs need them.",
      },
      { key: "asOf", label: "As of", kind: "date", required: true },
      { key: "source", label: "Source", kind: "text", maxLength: 80 },
    ],
    validate: (v) => {
      if (!v.baseCode?.trim() || !v.quoteCode?.trim()) return "A rate needs both currency codes"
      if (!/^\d+(\.\d{1,10})?$/.test(v.rate?.trim() ?? "")) return "Rate must be a decimal"
      if (Number(v.rate) <= 0) return "Rate must be greater than zero"
      return requireDate(v.asOf, "As of")
    },
    serialize: omitBlank,
  },

  /** Read-only: `GET /finance/accounts/:id/reconcile` returns a comparison. */
  "account-reconcile": {
    fields: [
      { key: "storedBalance", label: "Stored balance", kind: "text", readOnly: true },
      { key: "computedBalance", label: "Computed from ledger", kind: "text", readOnly: true },
      { key: "difference", label: "Difference", kind: "text", readOnly: true },
    ],
  },
}
