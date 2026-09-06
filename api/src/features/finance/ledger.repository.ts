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
  recurringTransactions,
  transactions,
  type NewRecurringTransactionRow,
  type NewTransactionRow,
  type RecurringTransactionRow,
  type TransactionRow,
} from '../../infrastructure/database/schema/finance.schema';

export interface TransactionQuery {
  kind?: TransactionRow['kind'];
  status?: TransactionRow['status'];
  accountId?: string;
  categoryId?: string;
  projectId?: string;
  contactId?: string;
  companyId?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}

@Injectable()
export class LedgerRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<TransactionRow | null> {
    const rows = await this.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(
    q: TransactionQuery,
  ): Promise<{ rows: TransactionRow[]; total: number }> {
    const filters: SQL[] = [eq(transactions.isDeleted, false)];
    if (q.kind) filters.push(eq(transactions.kind, q.kind));
    if (q.status) filters.push(eq(transactions.status, q.status));
    if (q.accountId) filters.push(eq(transactions.accountId, q.accountId));
    if (q.categoryId) filters.push(eq(transactions.categoryId, q.categoryId));
    if (q.projectId) filters.push(eq(transactions.projectId, q.projectId));
    if (q.contactId) filters.push(eq(transactions.contactId, q.contactId));
    if (q.companyId) filters.push(eq(transactions.companyId, q.companyId));
    if (q.from) filters.push(gte(transactions.occurredOn, q.from));
    if (q.to) filters.push(lte(transactions.occurredOn, q.to));
    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(transactions)
      .where(where)
      .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(transactions)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async create(
    values: NewTransactionRow,
    executor: DrizzleExecutor = this.db,
  ): Promise<TransactionRow> {
    const rows = await executor.insert(transactions).values(values).returning();
    return rows[0];
  }

  async update(
    id: string,
    patch: Partial<NewTransactionRow>,
  ): Promise<TransactionRow | null> {
    const rows = await this.db
      .update(transactions)
      .set(patch)
      .where(and(eq(transactions.id, id), eq(transactions.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(transactions)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(transactions.id, id));
  }

  /**
   * Income and expense totals over a period, grouped by kind.
   *
   * Reads `transactions_kind_date_idx`. Income reporting is a first-class query
   * here, not a filter applied to an expense report in memory.
   */
  async totalsByKind(
    from: string,
    to: string,
    projectId?: string,
  ): Promise<Array<{ kind: string; total: string; count: number }>> {
    const result = await this.db.execute<{
      kind: string;
      total: string;
      count: string;
    }>(sql`
      SELECT kind, COALESCE(SUM(amount), 0)::text AS total, COUNT(*)::text AS count
      FROM ${transactions}
      WHERE is_deleted = false
        AND status IN ('cleared', 'reconciled')
        AND occurred_on BETWEEN ${from} AND ${to}
        ${projectId ? sql`AND project_id = ${projectId}` : sql``}
      GROUP BY kind
    `);
    return result.rows.map((r) => ({
      kind: r.kind,
      total: r.total,
      count: Number(r.count),
    }));
  }

  /** Totals per category, for a spend or revenue breakdown. */
  async totalsByCategory(
    from: string,
    to: string,
    kind: TransactionRow['kind'],
  ): Promise<Array<{ categoryId: string | null; total: string }>> {
    const result = await this.db.execute<{
      category_id: string | null;
      total: string;
    }>(sql`
      SELECT category_id, COALESCE(SUM(amount), 0)::text AS total
      FROM ${transactions}
      WHERE is_deleted = false
        AND status IN ('cleared', 'reconciled')
        AND kind = ${kind}
        AND occurred_on BETWEEN ${from} AND ${to}
      GROUP BY category_id
      ORDER BY 2 DESC
    `);
    return result.rows.map((r) => ({
      categoryId: r.category_id,
      total: r.total,
    }));
  }

  /** Sum of an account's cleared movements — the balance reconciliation. */
  async reconcileBalance(accountId: string): Promise<string> {
    const result = await this.db.execute<{ balance: string }>(sql`
      SELECT COALESCE(SUM(
        CASE WHEN kind = 'income' THEN amount
             WHEN kind = 'expense' THEN -amount
             ELSE 0 END
      ), 0)::text AS balance
      FROM ${transactions}
      WHERE account_id = ${accountId} AND is_deleted = false
        AND status IN ('cleared', 'reconciled')
    `);
    return result.rows[0]?.balance ?? '0';
  }

  // --- recurring ---

  listRecurring(activeOnly = true): Promise<RecurringTransactionRow[]> {
    return this.db
      .select()
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.isDeleted, false),
          activeOnly ? eq(recurringTransactions.isActive, true) : undefined,
        ),
      )
      .orderBy(asc(recurringTransactions.nextDueOn));
  }

  async findRecurring(id: string): Promise<RecurringTransactionRow | null> {
    const rows = await this.db
      .select()
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.id, id),
          eq(recurringTransactions.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Schedules whose next occurrence has arrived.
   *
   * Hits `recurring_transactions_due_idx`, partial on active, live rows.
   */
  dueRecurring(onOrBefore: string): Promise<RecurringTransactionRow[]> {
    return this.db
      .select()
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.isDeleted, false),
          eq(recurringTransactions.isActive, true),
          lte(recurringTransactions.nextDueOn, onOrBefore),
        ),
      );
  }

  async createRecurring(
    values: NewRecurringTransactionRow,
  ): Promise<RecurringTransactionRow> {
    const rows = await this.db
      .insert(recurringTransactions)
      .values(values)
      .returning();
    return rows[0];
  }

  async updateRecurring(
    id: string,
    patch: Partial<NewRecurringTransactionRow>,
  ): Promise<RecurringTransactionRow | null> {
    const rows = await this.db
      .update(recurringTransactions)
      .set(patch)
      .where(
        and(
          eq(recurringTransactions.id, id),
          eq(recurringTransactions.isDeleted, false),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  async softDeleteRecurring(id: string): Promise<void> {
    await this.db
      .update(recurringTransactions)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(recurringTransactions.id, id));
  }
}
