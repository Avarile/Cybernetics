import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
  type DrizzleExecutor,
} from '../../infrastructure/database/drizzle.constants';
import {
  budgets,
  currencies,
  financialAccounts,
  financialCategories,
  fxRates,
  type BudgetRow,
  type CurrencyRow,
  type FinancialAccountRow,
  type FinancialCategoryRow,
  type FxRateRow,
  type NewBudgetRow,
  type NewFinancialAccountRow,
  type NewFinancialCategoryRow,
} from '../../infrastructure/database/schema/finance.schema';

/** Accounts, categories, budgets and the currency reference table. */
@Injectable()
export class FinanceRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  listCurrencies(): Promise<CurrencyRow[]> {
    return this.db
      .select()
      .from(currencies)
      .where(eq(currencies.isActive, true))
      .orderBy(asc(currencies.code));
  }

  async findCurrency(code: string): Promise<CurrencyRow | null> {
    const rows = await this.db
      .select()
      .from(currencies)
      .where(eq(currencies.code, code.toUpperCase()))
      .limit(1);
    return rows[0] ?? null;
  }

  // --- accounts ---

  listAccounts(): Promise<FinancialAccountRow[]> {
    return this.db
      .select()
      .from(financialAccounts)
      .where(eq(financialAccounts.isDeleted, false))
      .orderBy(asc(financialAccounts.name));
  }

  async findAccount(id: string): Promise<FinancialAccountRow | null> {
    const rows = await this.db
      .select()
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.id, id),
          eq(financialAccounts.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async createAccount(
    values: NewFinancialAccountRow,
  ): Promise<FinancialAccountRow> {
    const rows = await this.db
      .insert(financialAccounts)
      .values(values)
      .returning();
    return rows[0];
  }

  async updateAccount(
    id: string,
    patch: Partial<NewFinancialAccountRow>,
  ): Promise<FinancialAccountRow | null> {
    const rows = await this.db
      .update(financialAccounts)
      .set(patch)
      .where(
        and(
          eq(financialAccounts.id, id),
          eq(financialAccounts.isDeleted, false),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Apply a signed delta to an account balance.
   *
   * Relative SQL, not read-modify-write: two postings landing at once must not
   * lose one another's effect. The denormalized balance is reconcilable by
   * summing transactions, but it should not drift under ordinary load.
   */
  async adjustBalance(
    id: string,
    delta: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<void> {
    await executor
      .update(financialAccounts)
      .set({
        currentBalance: sql`${financialAccounts.currentBalance} + ${delta}::numeric`,
      })
      .where(eq(financialAccounts.id, id));
  }

  // --- categories ---

  listCategories(kind?: FinancialCategoryRow['kind']) {
    return this.db
      .select()
      .from(financialCategories)
      .where(
        and(
          eq(financialCategories.isDeleted, false),
          kind ? eq(financialCategories.kind, kind) : undefined,
        ),
      )
      .orderBy(asc(financialCategories.path));
  }

  async findCategory(id: string): Promise<FinancialCategoryRow | null> {
    const rows = await this.db
      .select()
      .from(financialCategories)
      .where(
        and(
          eq(financialCategories.id, id),
          eq(financialCategories.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findCategoryByKey(key: string): Promise<FinancialCategoryRow | null> {
    const rows = await this.db
      .select()
      .from(financialCategories)
      .where(
        and(
          eq(financialCategories.key, key),
          eq(financialCategories.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async createCategory(
    values: NewFinancialCategoryRow,
  ): Promise<FinancialCategoryRow> {
    const rows = await this.db
      .insert(financialCategories)
      .values(values)
      .returning();
    return rows[0];
  }

  // --- budgets ---

  async listBudgets(q: {
    projectId?: string;
    page: number;
    limit: number;
  }): Promise<{ rows: BudgetRow[]; total: number }> {
    const filters: SQL[] = [eq(budgets.isDeleted, false)];
    if (q.projectId) filters.push(eq(budgets.projectId, q.projectId));
    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(budgets)
      .where(where)
      .orderBy(desc(budgets.periodStart))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(budgets)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async findBudget(id: string): Promise<BudgetRow | null> {
    const rows = await this.db
      .select()
      .from(budgets)
      .where(and(eq(budgets.id, id), eq(budgets.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async createBudget(values: NewBudgetRow): Promise<BudgetRow> {
    const rows = await this.db.insert(budgets).values(values).returning();
    return rows[0];
  }

  async updateBudget(
    id: string,
    patch: Partial<NewBudgetRow>,
  ): Promise<BudgetRow | null> {
    const rows = await this.db
      .update(budgets)
      .set(patch)
      .where(and(eq(budgets.id, id), eq(budgets.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  async softDeleteBudget(id: string): Promise<void> {
    await this.db
      .update(budgets)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(budgets.id, id));
  }

  /**
   * Budgets a transaction falls inside — same project, category and period.
   *
   * Used to keep `spent_amount` current. A transaction can match more than one
   * budget (a project budget and a category budget), and both should move.
   */
  async budgetsMatching(input: {
    projectId: string | null;
    categoryId: string | null;
    occurredOn: string;
  }): Promise<BudgetRow[]> {
    return this.db
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.isDeleted, false),
          eq(budgets.status, 'active'),
          lte(budgets.periodStart, input.occurredOn),
          gte(budgets.periodEnd, input.occurredOn),
          input.projectId
            ? sql`(${budgets.projectId} IS NULL OR ${budgets.projectId} = ${input.projectId})`
            : sql`${budgets.projectId} IS NULL`,
          input.categoryId
            ? sql`(${budgets.categoryId} IS NULL OR ${budgets.categoryId} = ${input.categoryId})`
            : sql`${budgets.categoryId} IS NULL`,
        ),
      );
  }

  async adjustBudgetSpend(
    id: string,
    delta: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<void> {
    await executor
      .update(budgets)
      .set({ spentAmount: sql`${budgets.spentAmount} + ${delta}::numeric` })
      .where(eq(budgets.id, id));
  }

  /**
   * The rate archive, most recent first. Bounded because this is reference
   * data an operator scrolls, not a series a report streams.
   */
  listFxRates(
    filter: { baseCode?: string; quoteCode?: string } = {},
  ): Promise<FxRateRow[]> {
    const clauses: SQL[] = [];
    if (filter.baseCode)
      clauses.push(eq(fxRates.baseCode, filter.baseCode.toUpperCase()));
    if (filter.quoteCode)
      clauses.push(eq(fxRates.quoteCode, filter.quoteCode.toUpperCase()));
    return this.db
      .select()
      .from(fxRates)
      .where(clauses.length ? and(...clauses) : undefined)
      .orderBy(desc(fxRates.asOf), asc(fxRates.baseCode))
      .limit(500);
  }

  /**
   * Record a rate, correcting the same pair+date in place.
   *
   * `onConflictDoUpdate` against the unique index rather than a read-then-write:
   * two importers running the same feed concurrently would otherwise race
   * between the SELECT and the INSERT and one would fail on the constraint.
   */
  async upsertFxRate(row: {
    baseCode: string;
    quoteCode: string;
    rate: string;
    asOf: string;
    source?: string;
  }): Promise<FxRateRow> {
    const values = {
      baseCode: row.baseCode.toUpperCase(),
      quoteCode: row.quoteCode.toUpperCase(),
      rate: row.rate,
      asOf: row.asOf,
      source: row.source ?? null,
    };
    const inserted = await this.db
      .insert(fxRates)
      .values(values)
      .onConflictDoUpdate({
        target: [fxRates.baseCode, fxRates.quoteCode, fxRates.asOf],
        set: { rate: values.rate, source: values.source },
      })
      .returning();
    return inserted[0];
  }
}
