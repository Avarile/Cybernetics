import { WalletIcon } from "lucide-react"
import type { DomainTableConfig } from "@/components/data-table/types"
import type { DomainSpec } from "@/components/data-window/types"
import type {
  Budget,
  FinancialAccount,
  FinancialCategory,
  FxRate,
  Invoice,
  Recurring,
  Transaction,
} from "./finance.types"
import {
  DateCell,
  Money,
  ProgressCell,
  StatusBadge,
  TreeName,
  dash,
  type StatusStyle,
} from "./cells"
import {
  AccountName,
  CategoryName,
  FinanceLookupProvider,
  FinanceReports,
  useAccountExtras,
  useInvoiceExtras,
  useRecurringExtras,
  useTransactionExtras,
} from "./finance-actions"

const KIND_STYLES: Record<string, StatusStyle> = {
  income: { label: "Income", variant: "default" },
  expense: { label: "Expense", variant: "secondary" },
  transfer: { label: "Transfer", variant: "outline" },
}

export const TRANSACTION_STATUS_STYLES: Record<string, StatusStyle> = {
  draft: { label: "Draft", variant: "outline" },
  pending: { label: "Pending", variant: "secondary" },
  cleared: { label: "Cleared", variant: "default" },
  reconciled: { label: "Reconciled", variant: "default" },
  void: { label: "Void", variant: "destructive" },
}

const INVOICE_STATUS_STYLES: Record<string, StatusStyle> = {
  draft: { label: "Draft", variant: "outline" },
  sent: { label: "Sent", variant: "secondary" },
  partially_paid: { label: "Part paid", variant: "secondary" },
  paid: { label: "Paid", variant: "default" },
  overdue: { label: "Overdue", variant: "destructive" },
  void: { label: "Void", variant: "destructive" },
}

const ACCOUNT_KIND_STYLES: Record<string, StatusStyle> = {
  bank: { label: "Bank", variant: "default" },
  cash: { label: "Cash", variant: "secondary" },
  credit_card: { label: "Credit card", variant: "secondary" },
  receivable: { label: "Receivable", variant: "outline" },
  payable: { label: "Payable", variant: "outline" },
  other: { label: "Other", variant: "outline" },
}

/**
 * The ledger.
 *
 * `canEdit` and `canDelete` are FALSE and must stay so: the API exposes
 * neither PATCH nor DELETE on a transaction. That is deliberate — the schema
 * says outright that "a correction is a reversing entry, never an edit of a
 * settled row". Offering Edit would 404 and, worse, teach the wrong model of
 * what a ledger is. Status moves and reversals are row actions instead.
 */
export const transactionsConfig: DomainTableConfig<Transaction> = {
  key: "transactions",
  title: "Transactions",
  endpoint: "/finance/transactions",
  searchable: false,
  canCreate: true,
  canEdit: false,
  canDelete: false,
  permissions: { create: "finance.transaction.create", update: "finance.transaction.update" },
  emptyMessage: "No transactions match this view.",
  defaultSort: { key: "occurredOn", dir: "desc" },
  tabs: [
    { value: "all", label: "All", query: {} },
    { value: "income", label: "Income", query: { kind: "income" } },
    { value: "expense", label: "Expense", query: { kind: "expense" } },
    { value: "transfer", label: "Transfers", query: { kind: "transfer" } },
  ],
  filters: [
    {
      key: "status",
      label: "Status",
      options: [
        { value: "draft", label: "Draft" },
        { value: "pending", label: "Pending" },
        { value: "cleared", label: "Cleared" },
        { value: "reconciled", label: "Reconciled" },
        { value: "void", label: "Void" },
      ],
    },
    { key: "accountId", label: "Account", source: { endpoint: "/finance/accounts", labelKey: "name" } },
    { key: "categoryId", label: "Category", source: { endpoint: "/finance/categories", labelKey: "name" } },
    { key: "projectId", label: "Project", source: { endpoint: "/projects", labelKey: "name" }, searchable: true },
  ],
  columns: [
    { key: "occurredOn", header: "Date", cell: (r) => <DateCell value={r.occurredOn} />, hideable: false },
    { key: "description", header: "Description", cell: (r) => <span className="font-medium">{r.description}</span> },
    { key: "kind", header: "Kind", cell: (r) => <StatusBadge value={r.kind} map={KIND_STYLES} /> },
    {
      key: "amount",
      header: "Amount",
      numeric: true,
      // The sign is carried by `kind`, never by the column: the schema stores
      // a positive amount because "a signed amount PLUS a kind is two sources
      // of truth that will eventually disagree".
      cell: (r) => (
        <Money
          amount={r.amount}
          currency={r.currency}
          signed={r.kind === "income" ? "positive" : r.kind === "expense" ? "negative" : null}
        />
      ),
    },
    { key: "accountId", header: "Account", cell: (r) => <AccountName id={r.accountId} /> },
    { key: "categoryId", header: "Category", cell: (r) => <CategoryName id={r.categoryId} /> },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge value={r.status} map={TRANSACTION_STATUS_STYLES} />,
    },
    { key: "reference", header: "Reference", cell: (r) => dash(r.reference) },
  ],
}

export const invoicesConfig: DomainTableConfig<Invoice> = {
  key: "invoices",
  title: "Invoices",
  endpoint: "/invoices",
  canCreate: true,
  // Immutable once it leaves draft: "an issued invoice is a document someone
  // else holds a copy of". Changes are a void plus a new invoice.
  canEdit: false,
  canDelete: false,
  permissions: { create: "finance.invoice.manage", update: "finance.invoice.manage" },
  emptyMessage: "No invoices match this view.",
  defaultSort: { key: "issueDate", dir: "desc" },
  tabs: [
    { value: "all", label: "All", query: {} },
    { value: "draft", label: "Draft", query: { status: "draft" } },
    { value: "sent", label: "Sent", query: { status: "sent" } },
    { value: "overdue", label: "Overdue", query: { status: "overdue" } },
    { value: "paid", label: "Paid", query: { status: "paid" } },
  ],
  filters: [
    { key: "contactId", label: "Contact", source: { endpoint: "/contacts", labelKey: "displayName" }, searchable: true },
    { key: "projectId", label: "Project", source: { endpoint: "/projects", labelKey: "name" }, searchable: true },
  ],
  columns: [
    { key: "number", header: "Number", cell: (r) => <code className="text-xs font-medium">{r.number}</code>, hideable: false },
    { key: "issueDate", header: "Issued", cell: (r) => <DateCell value={r.issueDate} /> },
    { key: "dueDate", header: "Due", cell: (r) => <DateCell value={r.dueDate} /> },
    { key: "total", header: "Total", numeric: true, cell: (r) => <Money amount={r.total} currency={r.currency} /> },
    { key: "amountPaid", header: "Paid", numeric: true, cell: (r) => <Money amount={r.amountPaid} /> },
    {
      key: "balance",
      header: "Balance",
      numeric: true,
      // Derived rather than stored: the server sends total and amountPaid,
      // and a third figure that could disagree with them is worse than none.
      cell: (r) => <Money amount={subtract(r.total, r.amountPaid)} />,
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge value={r.status} map={INVOICE_STATUS_STYLES} />,
    },
  ],
}

/**
 * Decimal subtraction on strings, to four places.
 *
 * Never via Number: `total` and `amountPaid` are `numeric(20, 4)` and a
 * float subtraction of two large invoices produces a balance that is wrong
 * in the low digits and looks right. BigInt calls rather than `10_000n`
 * literals because the tsconfig target is ES2017.
 */
const SCALE = BigInt(10000)

export function subtract(a: string, b: string): string {
  const toUnits = (v: string) => {
    const negative = v.startsWith("-")
    const [whole = "0", frac = ""] = (negative ? v.slice(1) : v).split(".")
    const units = BigInt(whole) * SCALE + BigInt(frac.padEnd(4, "0").slice(0, 4))
    return negative ? -units : units
  }
  try {
    const diff = toUnits(a) - toUnits(b)
    const negative = diff < BigInt(0)
    const abs = negative ? -diff : diff
    return `${negative ? "-" : ""}${abs / SCALE}.${String(abs % SCALE).padStart(4, "0")}`
  } catch {
    // Not a decimal pair after all — show the total rather than a wrong
    // balance.
    return a
  }
}

export const budgetsConfig: DomainTableConfig<Budget> = {
  // No `GET /:id` on this endpoint (verified live) — seed from the row.
  noItemEndpoint: true,
  key: "budgets",
  title: "Budgets",
  // `{ rows, total }` — the third envelope spelling. rowsOf reads it.
  endpoint: "/finance/budgets",
  canCreate: true,
  canEdit: false,
  canDelete: false,
  permissions: { create: "finance.budget.manage" },
  emptyMessage: "No budgets for this view.",
  filters: [
    { key: "projectId", label: "Project", source: { endpoint: "/projects", labelKey: "name" }, searchable: true },
  ],
  columns: [
    { key: "name", header: "Name", cell: (r) => <span className="font-medium">{r.name}</span>, hideable: false },
    {
      key: "periodStart",
      header: "Period",
      cell: (r) => (
        <span className="text-xs tabular-nums">
          {r.periodStart} → {r.periodEnd}
        </span>
      ),
    },
    { key: "amount", header: "Amount", numeric: true, cell: (r) => <Money amount={r.amount} currency={r.currency} /> },
    { key: "spentAmount", header: "Spent", numeric: true, cell: (r) => <Money amount={r.spentAmount} /> },
    {
      key: "used",
      header: "Used",
      // Tinted at this budget's OWN threshold: one that alerts at 50% and one
      // that alerts at 95% should not look the same at 60%.
      cell: (r) => (
        <ProgressCell value={r.spentAmount} total={r.amount} thresholdPct={r.alertThresholdPct} />
      ),
    },
    { key: "status", header: "Status", cell: (r) => dash(r.status) },
  ],
}

export const accountsConfig: DomainTableConfig<FinancialAccount> = {
  // No `GET /:id` on this endpoint (verified live) — seed from the row.
  noItemEndpoint: true,
  key: "accounts",
  title: "Accounts",
  endpoint: "/finance/accounts",
  source: "collection",
  searchable: true,
  canCreate: true,
  // No PATCH and no DELETE exist on an account.
  canEdit: false,
  canDelete: false,
  permissions: { create: "finance.transaction.create" },
  emptyMessage: "No accounts yet.",
  columns: [
    { key: "name", header: "Name", cell: (r) => <span className="font-medium">{r.name}</span>, hideable: false },
    { key: "kind", header: "Kind", cell: (r) => <StatusBadge value={r.kind} map={ACCOUNT_KIND_STYLES} /> },
    { key: "institution", header: "Institution", cell: (r) => dash(r.institution) },
    { key: "currency", header: "Currency", cell: (r) => dash(r.currency) },
    {
      key: "currentBalance",
      header: "Balance",
      numeric: true,
      cell: (r) => <Money amount={r.currentBalance} currency={r.currency} />,
    },
    {
      key: "isActive",
      header: "Active",
      cell: (r) => (r.isActive ? <span className="text-xs">Yes</span> : dash(null)),
    },
  ],
}

/**
 * Recurring income and expenses.
 *
 * `recurring.service.list(activeOnly = true)` takes a parameter the
 * controller never passes, so INACTIVE SCHEDULES ARE INVISIBLE here. The
 * hint and the Active column both say so rather than implying the list is
 * complete.
 */
export const recurringConfig: DomainTableConfig<Recurring> = {
  // No `GET /:id` on this endpoint (verified live) — seed from the row.
  noItemEndpoint: true,
  key: "recurring",
  title: "Recurring",
  endpoint: "/finance/recurring",
  source: "collection",
  searchable: true,
  canCreate: true,
  canEdit: false,
  canDelete: true,
  permissions: { create: "finance.transaction.create", delete: "finance.transaction.update" },
  emptyMessage: "No active recurring schedules.",
  columns: [
    { key: "name", header: "Name", cell: (r) => <span className="font-medium">{r.name}</span>, hideable: false },
    { key: "kind", header: "Kind", cell: (r) => <StatusBadge value={r.kind} map={KIND_STYLES} /> },
    {
      key: "amount",
      header: "Amount",
      numeric: true,
      cell: (r) => (
        <Money
          amount={r.amount}
          currency={r.currency}
          signed={r.kind === "income" ? "positive" : r.kind === "expense" ? "negative" : null}
        />
      ),
    },
    { key: "frequency", header: "Frequency", cell: (r) => dash(r.frequency) },
    { key: "nextDueOn", header: "Next due", cell: (r) => <DateCell value={r.nextDueOn} /> },
    {
      key: "autoPost",
      header: "Auto-post",
      // False means forecast only — nothing posts without confirmation. Worth
      // a column of its own: the difference is money moving or not.
      cell: (r) =>
        r.autoPost ? (
          <span className="text-xs">Posts automatically</span>
        ) : (
          <span className="text-xs text-muted-foreground">Forecast only</span>
        ),
    },
  ],
}

export const financeCategoriesConfig: DomainTableConfig<FinancialCategory> = {
  key: "finance-categories",
  title: "Categories",
  endpoint: "/finance/categories",
  source: "collection",
  searchable: true,
  // The repository has createCategory; no controller route reaches it.
  canCreate: false,
  canEdit: false,
  canDelete: false,
  selectable: false,
  emptyMessage: "No categories configured.",
  defaultSort: { key: "path", dir: "asc" },
  columns: [
    { key: "name", header: "Name", cell: (r) => <TreeName depth={r.depth} name={r.name} />, hideable: false },
    { key: "kind", header: "Kind", cell: (r) => <StatusBadge value={r.kind} map={KIND_STYLES} /> },
    { key: "key", header: "Key", cell: (r) => <code className="text-xs">{r.key}</code> },
    { key: "description", header: "Description", cell: (r) => dash(r.description) },
  ],
}

export const fxRatesConfig: DomainTableConfig<FxRate> = {
  // No `GET /:id` on this endpoint (verified live) — seed from the row.
  noItemEndpoint: true,
  key: "fx-rates",
  title: "FX rates",
  endpoint: "/finance/fx-rates",
  source: "collection",
  searchable: true,
  canCreate: true,
  canEdit: false,
  canDelete: false,
  permissions: { create: "finance.fx.manage" },
  emptyMessage: "No exchange rates recorded.",
  defaultSort: { key: "asOf", dir: "desc" },
  columns: [
    {
      key: "baseCode",
      header: "Pair",
      hideable: false,
      cell: (r) => (
        <code className="text-xs font-medium">
          {r.baseCode}/{r.quoteCode}
        </code>
      ),
    },
    { key: "rate", header: "Rate", numeric: true, cell: (r) => <span className="tabular-nums">{r.rate}</span> },
    { key: "asOf", header: "As of", cell: (r) => <DateCell value={r.asOf} /> },
    { key: "source", header: "Source", cell: (r) => dash(r.source) },
  ],
}

export const financeDomain: DomainSpec = {
  key: "finance",
  label: "Finance",
  icon: WalletIcon,
  sections: [
    {
      key: "transactions",
      label: "Transactions",
      hint: "A settled entry is corrected by a reversing entry, never edited.",
      body: {
        kind: "table",
        config: transactionsConfig,
        titleOf: (r: Transaction) => r.description,
        useExtras: useTransactionExtras,
        // The Account and Category columns are foreign keys. The wrapper
        // resolves both lookups once for the whole table instead of once per
        // cell — see FinanceLookupProvider.
        wrapper: FinanceLookupProvider,
      },
    },
    {
      key: "invoices",
      label: "Invoices",
      body: {
        kind: "table",
        config: invoicesConfig,
        titleOf: (r: Invoice) => r.number,
        useExtras: useInvoiceExtras,
      },
    },
    {
      key: "budgets",
      label: "Budgets",
      body: {
        kind: "table",
        config: budgetsConfig,
        titleOf: (r: Budget) => r.name,
      },
    },
    {
      key: "accounts",
      label: "Accounts",
      body: {
        kind: "table",
        config: accountsConfig,
        titleOf: (r: FinancialAccount) => r.name,
        useExtras: useAccountExtras,
      },
    },
    {
      key: "recurring",
      label: "Recurring",
      hint: "Only active schedules are listed — the API exposes no way to see stopped ones.",
      body: {
        kind: "table",
        config: recurringConfig,
        titleOf: (r: Recurring) => r.name,
        useExtras: useRecurringExtras,
      },
    },
    {
      key: "reports",
      label: "Reports",
      body: { kind: "custom", render: () => <FinanceReports /> },
    },
    {
      key: "categories",
      label: "Categories",
      secondary: true,
      hint: "Read-only: the API exposes no route to create or change one.",
      body: {
        kind: "table",
        config: financeCategoriesConfig,
        titleOf: (r: FinancialCategory) => r.name,
      },
    },
    {
      key: "fx-rates",
      label: "FX rates",
      secondary: true,
      hint: "Recording a pair on a date it already has corrects that observation.",
      body: { kind: "table", config: fxRatesConfig, titleOf: (r: FxRate) => r.baseCode },
    },
  ],
}
