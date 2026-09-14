/**
 * Finance wire shapes.
 *
 * Split from the config so the eight section definitions stay readable and
 * so `finance-actions.tsx` can import a type without importing the configs
 * it is itself imported by.
 */

export interface Transaction {
  id: string
  kind: "income" | "expense" | "transfer"
  occurredOn: string
  amount: string
  currency: string
  accountId: string
  counterAccountId: string | null
  categoryId: string | null
  projectId: string | null
  contactId: string | null
  description: string
  reference: string | null
  status: "draft" | "pending" | "cleared" | "reconciled" | "void"
}

export interface FinancialAccount {
  id: string
  name: string
  kind: "bank" | "cash" | "credit_card" | "receivable" | "payable" | "other"
  currency: string
  openingBalance: string
  currentBalance: string
  institution: string | null
  accountRef: string | null
  isActive: boolean
}

export interface Invoice {
  id: string
  number: string
  contactId: string | null
  companyId: string | null
  projectId: string | null
  issueDate: string
  dueDate: string
  currency: string
  subtotal: string
  taxTotal: string
  total: string
  amountPaid: string
  status: "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "void"
}

export interface Budget {
  id: string
  name: string
  projectId: string | null
  categoryId: string | null
  periodStart: string
  periodEnd: string
  amount: string
  currency: string
  spentAmount: string
  alertThresholdPct: number
  status: string
}

export interface Recurring {
  id: string
  name: string
  kind: Transaction["kind"]
  amount: string
  currency: string
  frequency: "weekly" | "fortnightly" | "monthly" | "quarterly" | "yearly"
  startDate: string
  endDate: string | null
  nextDueOn: string | null
  autoPost: boolean
  isActive: boolean
  description: string | null
}

export interface FinancialCategory {
  id: string
  key: string
  name: string
  kind: "income" | "expense" | "transfer"
  description: string | null
  path: string
  depth: number
}

export interface FxRate {
  id: string
  baseCode: string
  quoteCode: string
  rate: string
  asOf: string
  source: string | null
}
