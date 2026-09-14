"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import {
  CheckIcon,
  FileTextIcon,
  PlayIcon,
  ReceiptIcon,
  RotateCcwIcon,
  ScaleIcon,
  XIcon,
} from "lucide-react"
import type { RowAction } from "@/components/data-table/types"
import { LookupCell } from "./cells"
import { useLookup, type Lookup } from "@/features/records/use-lookup"
import { useRowAction } from "@/features/records/use-row-action"
import { useWorkspace } from "@/features/workspace/use-workspace"
import type { FinancialAccount, Invoice, Recurring, Transaction } from "./finance.types"

export function useAccountLookup() {
  return useLookup("/finance/accounts", "name")
}
export function useCategoryLookup() {
  return useLookup("/finance/categories", "name")
}

/**
 * Both finance lookups, resolved ONCE for a whole table.
 *
 * `AccountName` and `CategoryName` used to call `useLookup` — and therefore
 * `useSWR` — inside the cell renderer. A twenty-row ledger page was forty
 * subscriptions against two cache keys, re-subscribed on every render of the
 * table, and `useLookup` rebuilt its id→label Map and its options array once
 * per call site. SWR deduplicated the *requests*, which is what hid this; it
 * does not deduplicate the subscription or the per-call memo.
 *
 * Context is the seam the table already provides for this (`SectionBody.wrapper`,
 * data-window/types.ts): a `cell()` callback cannot call hooks, so a provider
 * above the table is the only way for every cell to share one instance.
 */
interface FinanceLookups {
  accounts: Lookup
  categories: Lookup
}

const FinanceLookupCtx = createContext<FinanceLookups | null>(null)

export function FinanceLookupProvider({ children }: { children: ReactNode }) {
  const accounts = useAccountLookup()
  const categories = useCategoryLookup()
  const value = useMemo(() => ({ accounts, categories }), [accounts, categories])
  return <FinanceLookupCtx.Provider value={value}>{children}</FinanceLookupCtx.Provider>
}

/**
 * The em dash, for a cell rendered outside the provider.
 *
 * Not a fallback `useLookup()` call — a hook cannot be called conditionally,
 * and reinstating one here would put the per-cell subscription straight back.
 * Every config that uses these columns declares the wrapper; this is what a
 * future one that forgets renders, and it is quiet rather than wrong.
 */
const NO_LOOKUP: Lookup = {
  label: () => "—",
  has: () => false,
  options: [],
  isLoading: false,
  truncated: false,
}

export function AccountName({ id }: { id: string | null }) {
  return <LookupCell id={id} lookup={useContext(FinanceLookupCtx)?.accounts ?? NO_LOOKUP} />
}

export function CategoryName({ id }: { id: string | null }) {
  return <LookupCell id={id} lookup={useContext(FinanceLookupCtx)?.categories ?? NO_LOOKUP} />
}

/**
 * Ledger verbs.
 *
 * `transactions` has no PATCH and no DELETE. Everything a user can do to a
 * settled row goes through a POST that the service guards with a row lock —
 * `findByIdForUpdate` exists because twelve concurrent `pending → cleared`
 * calls once applied one posting's balance effect eight times.
 *
 * Each action is hidden where the transition is illegal from the row's
 * current status, so the menu shows what this row can actually do.
 */
export function useTransactionExtras() {
  const { run } = useRowAction("/finance/transactions")
  const { openWindow } = useWorkspace()

  return useMemo(() => {
    const status = (to: Transaction["status"], label: string, from: Transaction["status"][]) => ({
      label,
      icon: CheckIcon,
      visible: (r: Transaction) => from.includes(r.status),
      onSelect: (r: Transaction) =>
        void run(`/finance/transactions/${r.id}/status/${to}`, undefined, `${r.description} — ${label}`),
    })

    const actions: RowAction<Transaction>[] = [
      status("pending", "Mark pending", ["draft"]),
      status("cleared", "Mark cleared", ["draft", "pending"]),
      status("reconciled", "Mark reconciled", ["cleared"]),
      {
        label: "Void",
        icon: XIcon,
        destructive: true,
        visible: (r) => r.status !== "void" && r.status !== "reconciled",
        onSelect: (r) =>
          openWindow({
            kind: "confirm",
            title: "Void transaction",
            singletonKey: `confirm:txn-void:${r.id}`,
            props: {
              message: `Void “${r.description}”? A voided entry stays in the ledger and stops affecting balances.`,
              confirmLabel: "Void",
              destructive: true,
              endpoint: "/finance/transactions",
              postTo: `/finance/transactions/${r.id}/status/void`,
            },
          }),
      },
      {
        label: "Reverse…",
        icon: RotateCcwIcon,
        destructive: true,
        visible: (r) => r.status === "cleared" || r.status === "reconciled",
        onSelect: (r) =>
          openWindow({
            kind: "confirm",
            title: "Reverse transaction",
            singletonKey: `confirm:txn-reverse:${r.id}`,
            props: {
              message: `Post a reversing entry for “${r.description}”? The original stays; a mirrored entry cancels it.`,
              confirmLabel: "Reverse",
              destructive: true,
              endpoint: "/finance/transactions",
              postTo: `/finance/transactions/${r.id}/reverse`,
            },
          }),
      },
    ]
    return { rowActions: actions }
  }, [run, openWindow])
}

/**
 * Invoice verbs, each gated on the status that permits it.
 *
 * An invoice is immutable once issued, so the lifecycle IS the interface:
 * add lines while draft, issue, take payments, void.
 */
export function useInvoiceExtras() {
  // No `useRowAction` here: every invoice verb is destructive or takes input,
  // so each one routes through a confirm or a create window rather than
  // firing on a menu click.
  const { openWindow } = useWorkspace()

  return useMemo(() => {
    const actions: RowAction<Invoice>[] = [
      {
        label: "Add line…",
        icon: FileTextIcon,
        visible: (r) => r.status === "draft",
        onSelect: (r) =>
          openWindow({
            kind: "record-create",
            title: `Add a line to ${r.number}`,
            singletonKey: `invoice-line:create:${r.id}`,
            props: { domain: "invoice-line", endpoint: `/invoices/${r.id}/lines` },
          }),
      },
      {
        label: "Issue",
        icon: PlayIcon,
        visible: (r) => r.status === "draft",
        onSelect: (r) =>
          openWindow({
            kind: "confirm",
            title: "Issue invoice",
            singletonKey: `confirm:invoice-issue:${r.id}`,
            props: {
              message: `Issue ${r.number}? Its number is allocated and the invoice becomes immutable — corrections after this are a void plus a new invoice.`,
              confirmLabel: "Issue",
              endpoint: "/invoices",
              postTo: `/invoices/${r.id}/issue`,
            },
          }),
      },
      {
        label: "Record payment…",
        icon: ReceiptIcon,
        visible: (r) => r.status === "sent" || r.status === "partially_paid" || r.status === "overdue",
        onSelect: (r) =>
          openWindow({
            kind: "record-create",
            title: `Payment on ${r.number}`,
            singletonKey: `payment:create:${r.id}`,
            props: { domain: "payment", endpoint: `/invoices/${r.id}/payments` },
          }),
      },
      {
        label: "Void",
        icon: XIcon,
        destructive: true,
        visible: (r) => r.status !== "void" && r.status !== "paid",
        onSelect: (r) =>
          openWindow({
            kind: "confirm",
            title: "Void invoice",
            singletonKey: `confirm:invoice-void:${r.id}`,
            props: {
              message: `Void ${r.number}? Someone else may hold a copy of this document.`,
              confirmLabel: "Void",
              destructive: true,
              endpoint: "/invoices",
              postTo: `/invoices/${r.id}/void`,
            },
          }),
      },
    ]
    return { rowActions: actions }
  }, [openWindow])
}

export function useAccountExtras() {
  const { openWindow } = useWorkspace()
  return useMemo(() => {
    const actions: RowAction<FinancialAccount>[] = [
      {
        label: "Reconcile",
        icon: ScaleIcon,
        // GET, not a mutation: it compares the stored balance against the sum
        // of the ledger and reports the difference.
        onSelect: (r) =>
          openWindow({
            kind: "record-detail",
            title: `Reconcile ${r.name}`,
            singletonKey: `account:reconcile:${r.id}`,
            props: {
              domain: "account-reconcile",
              endpoint: `/finance/accounts/${r.id}/reconcile`,
              id: r.id,
            },
          }),
      },
    ]
    return { rowActions: actions }
  }, [openWindow])
}

/**
 * "Materialize due" writes ledger rows, so it confirms first.
 *
 * A toolbar action rather than a row action: it acts on every schedule that
 * is due, not on the row the menu was opened from.
 */
export function useRecurringExtras() {
  const { openWindow } = useWorkspace()
  return useMemo(
    () => ({
      toolbarExtra: (
        <div className="pb-2">
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
            onClick={() =>
              openWindow({
                kind: "confirm",
                title: "Generate due transactions",
                singletonKey: "confirm:recurring-materialize",
                props: {
                  message:
                    "Generate transactions for every schedule that is due? This writes rows into the ledger.",
                  confirmLabel: "Generate",
                  endpoint: "/finance/recurring",
                  postTo: "/finance/recurring/materialize",
                },
              })
            }
          >
            Generate due transactions
          </button>
        </div>
      ),
      rowActions: [] as RowAction<Recurring>[],
    }),
    [openWindow],
  )
}

export { FinanceReports } from "./finance-reports"
