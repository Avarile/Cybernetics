import type { ApiClient } from '../../core/http/api.client';
import { schemas } from '../../generated/schemas';

/**
 * `GET /finance/transactions/{id}` response shape (`TransactionRow` in
 * api/src/infrastructure/database/schema/finance.schema.ts) — a raw DB row,
 * same as tasks (see tasks.helpers.ts's TaskRecord doc comment): there is no
 * projection, so `isDeleted`/`deletedAt`/`metadata` really are response
 * fields.
 *
 * `amount`, `baseAmount` and `fxRate` are `numeric` columns. Drizzle returns
 * `numeric` as a string by default (confirmed against the schema: no `mode`
 * option is set), and the DTOs validate them with a decimal-string regex
 * (`money.util.ts`), never `z.number()`. They stay strings end to end here —
 * never parsed, summed or reformatted — because `0.1 + 0.2 !== 0.3` and a
 * ledger is the one place that must not lie about that.
 */
export interface TransactionRecord {
  id: string;
  kind: string;
  occurredOn: string;
  amount: string;
  currency: string;
  baseAmount: string | null;
  fxRate: string | null;
  fxRateAt: string | null;
  accountId: string;
  counterAccountId: string | null;
  categoryId: string | null;
  projectId: string | null;
  taskId: string | null;
  contactId: string | null;
  companyId: string | null;
  invoiceId: string | null;
  description: string;
  reference: string | null;
  receiptFileId: string | null;
  status: string;
  reversesTransactionId: string | null;
  recurringTransactionId: string | null;
  createdBy: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
  deletedAt: string | null;
}

/** `GET /finance/transactions` response envelope. */
export interface TransactionListEnvelope {
  data: TransactionRecord[];
  total: number;
  page: number;
  limit: number;
}

/** `GET /finance/accounts` response row — also a raw DB row, same reasoning as `TransactionRecord`. */
export interface FinancialAccountRecord {
  id: string;
  name: string;
  kind: string;
  currency: string;
  openingBalance: string;
  currentBalance: string;
  institution: string | null;
  accountRef: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
  deletedAt: string | null;
}

/** `GET /finance/categories` response row. */
export interface FinancialCategoryRecord {
  id: string;
  key: string;
  name: string;
  kind: string;
  parentId: string | null;
  path: string;
}

/** `GET /finance/budgets` response row. */
export interface BudgetRecord {
  id: string;
  name: string;
  projectId: string | null;
  categoryId: string | null;
  periodStart: string;
  periodEnd: string;
  amount: string;
  currency: string;
  spentAmount: string;
  alertThresholdPct: number;
  ownerUserId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
  deletedAt: string | null;
}

/**
 * `GET /finance/budgets` response envelope.
 *
 * NOT the `{ data, total, page, limit }` shape every other list endpoint in
 * this codebase uses. `FinanceController.budgets` returns
 * `FinanceRepository.listBudgets`'s result directly — `{ rows, total }` —
 * without the controller re-wrapping `page`/`limit` back onto it the way
 * `LedgerService.list`/`InvoiceService.list` do (confirmed against
 * finance.controller.ts and finance.repository.ts). Real, not a typo: the
 * request `page`/`limit` are echoed nowhere in the response, so pagination
 * notes here are computed from what was asked for, not from the envelope.
 */
export interface BudgetListEnvelope {
  rows: BudgetRecord[];
  total: number;
}

/** One entry of `GET /finance/budgets/at-risk` — a bare array, not paginated. */
export interface BudgetAtRisk {
  budget: BudgetRecord;
  usedPct: number;
}

/** `GET /finance/recurring` response row — a bare array, not paginated. */
export interface RecurringTransactionRecord {
  id: string;
  name: string;
  kind: string;
  amount: string;
  currency: string;
  frequency: string;
  dayOfPeriod: number | null;
  startDate: string;
  endDate: string | null;
  nextDueOn: string | null;
  lastGeneratedOn: string | null;
  accountId: string | null;
  categoryId: string | null;
  projectId: string | null;
  contactId: string | null;
  companyId: string | null;
  autoPost: boolean;
  isActive: boolean;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
  deletedAt: string | null;
}

/** One entry of `GET /finance/reports/forecast` — a bare array. */
export interface ForecastEntry {
  name: string;
  kind: string;
  amount: string;
  dueOn: string;
}

/** One entry of `GET /finance/reports/income-by-category` and `.../spend-by-category` — a bare array. */
export interface CategoryTotal {
  categoryId: string | null;
  total: string;
}

/** `GET /finance/reports/summary` response — a single object, not a list. */
export interface FinanceSummary {
  from: string;
  to: string;
  income: string;
  expense: string;
  net: string;
  byKind: Array<{ kind: string; total: string; count: number }>;
}

/** `CreateTransactionDto`'s schema, unmodified. */
export const FINANCE_TX_CREATE_SCHEMA: unknown = schemas['CreateTransactionDto'];
/** `CreateAccountDto`'s schema, unmodified. */
export const FINANCE_ACCOUNT_CREATE_SCHEMA: unknown = schemas['CreateAccountDto'];
/** `CreateBudgetDto`'s schema, unmodified. */
export const FINANCE_BUDGET_CREATE_SCHEMA: unknown = schemas['CreateBudgetDto'];
/** `CreateRecurringDto`'s schema, unmodified. */
export const FINANCE_RECURRING_CREATE_SCHEMA: unknown = schemas['CreateRecurringDto'];

export const FINANCE_TX_TEMPLATE_HEADER = [
  'occurredOn is a date: YYYY-MM-DD.',
  'amount / baseAmount / fxRate are decimal strings, never bare numbers — quote a value ' +
    'that YAML would otherwise read as a number (e.g. "0.10").',
  "A transfer (kind: transfer) requires counterAccountId, and it cannot equal accountId — " +
    'that rule is enforced server-side and does not appear in this schema, so a violation ' +
    'reopens this buffer annotated with the issue rather than being caught here.',
];

export const FINANCE_ACCOUNT_TEMPLATE_HEADER = [
  'currency is a three-letter ISO code (e.g. USD).',
  'openingBalance is a decimal string, never a bare number.',
];

export const FINANCE_BUDGET_TEMPLATE_HEADER = [
  'periodStart / periodEnd are dates: YYYY-MM-DD.',
  'amount is a decimal string, never a bare number.',
];

export const FINANCE_RECURRING_TEMPLATE_HEADER = [
  'startDate / endDate are dates: YYYY-MM-DD.',
  'amount is a decimal string, never a bare number.',
  'autoPost defaults to false: a schedule only forecasts until this is set true.',
];

/**
 * See `core/render/pagination-note.ts` for the shared implementation this
 * re-exports — works unchanged for both `{ data, total, page, limit }`
 * envelopes finance/invoices use.
 */
export { morePagesNote } from '../../core/render/pagination-note';

/**
 * Same announcement as `morePagesNote`, for `BudgetListEnvelope` — which
 * carries no `page`/`limit` of its own (see that interface's doc comment),
 * so the page/limit actually requested must be passed in separately.
 */
export function budgetMorePagesNote(
  envelope: BudgetListEnvelope,
  page: number,
  limit: number,
): string | null {
  const seenSoFar = (page - 1) * limit + envelope.rows.length;
  const remaining = envelope.total - seenSoFar;
  if (remaining <= 0) return null;

  return (
    `${remaining} more record(s) beyond this page — use --page ${page + 1} ` +
    `(or a larger --limit) to see them.`
  );
}

/**
 * Resolves every financial account id to its name, for rendering `tx ls`'s
 * `ACCOUNT` column.
 *
 * `TransactionRow` carries only `accountId` — no account name — so `ACCOUNT`
 * cannot be rendered from the transactions payload alone, and a bare UUID is
 * forbidden (see the ASSIGNEE/REF reasoning in tasks-ls.command.ts). Unlike
 * `GET /users/{id}` (admin-only), `GET /finance/accounts` is `@Roles('user',
 * 'admin')` and returns every account in one unpaginated call, so resolving
 * it here is both safe for ordinary accounts and cheap — one request per
 * `tx ls` invocation, not one per row.
 */
export async function resolveAccountNames(client: ApiClient): Promise<Map<string, string>> {
  const accounts = await client.get<FinancialAccountRecord[]>('/finance/accounts');
  return new Map(accounts.map((a) => [a.id, a.name]));
}

/**
 * Resolves every financial category id to its name, for rendering the
 * category breakdown reports without a bare UUID. Same reasoning and the
 * same non-gated, unpaginated shape as `resolveAccountNames`.
 */
export async function resolveCategoryNames(client: ApiClient): Promise<Map<string, string>> {
  const categories = await client.get<FinancialCategoryRecord[]>('/finance/categories');
  return new Map(categories.map((c) => [c.id, c.name]));
}
