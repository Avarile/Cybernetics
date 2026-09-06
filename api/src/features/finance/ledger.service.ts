import { Inject, Injectable, Logger } from '@nestjs/common';
import { userIdOrNull, type Principal } from '../../common/principal';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type { TransactionRow } from '../../infrastructure/database/schema/finance.schema';
import { ActivityService } from '../shared/activity.service';
import type {
  CreateAccountDto,
  CreateBudgetDto,
  CreateTransactionDto,
  ListTransactionsDto,
} from './dto/finance.dto';
import { FinanceRepository } from './finance.repository';
import { LedgerRepository, type TransactionQuery } from './ledger.repository';
import { compare, sum } from './money.util';

/** Statuses at which a transaction has moved money. */
const SETTLED: TransactionRow['status'][] = ['cleared', 'reconciled'];

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly ledger: LedgerRepository,
    private readonly finance: FinanceRepository,
    private readonly activity: ActivityService,
    private readonly errors: ExceptionService,
  ) {}

  // --- accounts ---

  listAccounts() {
    return this.finance.listAccounts();
  }

  async createAccount(dto: CreateAccountDto) {
    if (!(await this.finance.findCurrency(dto.currency))) {
      throw this.errors.validation([
        { path: 'currency', message: `Unknown currency "${dto.currency}"` },
      ]);
    }
    return this.finance.createAccount({
      ...dto,
      // An account starts at its opening balance; postings move it from there.
      currentBalance: dto.openingBalance,
    });
  }

  /** Compare the denormalized balance with the ledger it summarizes. */
  async reconcileAccount(id: string) {
    const account = await this.requireAccount(id);
    const derived = sum([
      account.openingBalance,
      await this.ledger.reconcileBalance(id),
    ]);
    return {
      accountId: id,
      storedBalance: account.currentBalance,
      derivedBalance: derived,
      inSync: compare(account.currentBalance, derived) === 0,
    };
  }

  // --- transactions ---

  async list(dto: ListTransactionsDto) {
    const query: TransactionQuery = dto;
    const { rows, total } = await this.ledger.list(query);
    return { data: rows, total, page: dto.page, limit: dto.limit };
  }

  async get(id: string): Promise<TransactionRow> {
    const row = await this.ledger.findById(id);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    return row;
  }

  /**
   * Post a transaction.
   *
   * The row, the account balance and any matching budget move in ONE
   * transaction: a balance that reflects a posting which rolled back is worse
   * than a balance that is merely stale.
   */
  async create(
    dto: CreateTransactionDto,
    principal: Principal,
  ): Promise<TransactionRow> {
    const account = await this.requireAccount(dto.accountId);
    if (account.currency !== dto.currency) {
      // An account is single-currency by design; mixing units in one balance
      // makes it meaningless.
      throw this.errors.validation([
        {
          path: 'currency',
          message: `Account "${account.name}" is in ${account.currency}`,
        },
      ]);
    }
    if (dto.counterAccountId) await this.requireAccount(dto.counterAccountId);

    const row = await this.db.transaction(async (tx) => {
      const created = await this.ledger.create(
        {
          ...dto,
          createdBy: userIdOrNull(principal),
        },
        tx,
      );
      if (SETTLED.includes(created.status)) {
        await this.applyEffects(created, 1, tx);
      }
      return created;
    });

    await this.activity.recordSafe({
      principal,
      entityType: 'transaction',
      entityId: row.id,
      projectId: row.projectId,
      action: `finance.${row.kind}_recorded`,
      summary: `${row.amount} ${row.currency} — ${row.description}`,
    });
    return row;
  }

  /**
   * Change a transaction's status, applying the balance effects of the move.
   *
   * The only mutation a settled transaction accepts. Amounts are immutable once
   * cleared: a correction is a reversing entry, so history stays auditable.
   */
  async setStatus(
    id: string,
    status: TransactionRow['status'],
    principal: Principal,
  ): Promise<TransactionRow> {
    const existing = await this.get(id);
    if (existing.status === status) return existing;

    const wasSettled = SETTLED.includes(existing.status);
    const willSettle = SETTLED.includes(status);

    const row = await this.db.transaction(async (tx) => {
      const updated = await this.ledger.update(id, { status });
      if (!updated) throw this.errors.create(ErrorCode.NOT_FOUND);
      if (!wasSettled && willSettle) await this.applyEffects(updated, 1, tx);
      if (wasSettled && !willSettle) await this.applyEffects(updated, -1, tx);
      return updated;
    });

    await this.activity.recordSafe({
      principal,
      entityType: 'transaction',
      entityId: id,
      action: 'finance.transaction_status_changed',
      changes: { status: { from: existing.status, to: status } },
    });
    return row;
  }

  /**
   * Reverse a settled transaction.
   *
   * A new, opposite entry rather than an edit or a delete. The original stays
   * exactly as it was recorded, which is what makes the ledger auditable —
   * and `reverses_transaction_id` ties the pair together.
   */
  async reverse(id: string, principal: Principal): Promise<TransactionRow> {
    const original = await this.get(id);
    if (!SETTLED.includes(original.status)) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: 'Only a settled transaction needs reversing; void it instead',
      });
    }
    if (original.reversesTransactionId) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: 'A reversal cannot itself be reversed',
      });
    }

    const opposite: TransactionRow['kind'] =
      original.kind === 'income'
        ? 'expense'
        : original.kind === 'expense'
          ? 'income'
          : 'transfer';

    return this.db.transaction(async (tx) => {
      const reversal = await this.ledger.create(
        {
          kind: opposite,
          occurredOn: new Date().toISOString().slice(0, 10),
          amount: original.amount,
          currency: original.currency,
          accountId: original.accountId,
          counterAccountId: original.counterAccountId,
          categoryId: original.categoryId,
          projectId: original.projectId,
          contactId: original.contactId,
          companyId: original.companyId,
          description: `Reversal of: ${original.description}`,
          status: 'cleared',
          reversesTransactionId: original.id,
          createdBy: userIdOrNull(principal),
        },
        tx,
      );
      await this.applyEffects(reversal, 1, tx);
      return reversal;
    });
  }

  // --- budgets ---

  listBudgets(projectId: string | undefined, page: number, limit: number) {
    return this.finance.listBudgets({ projectId, page, limit });
  }

  async createBudget(dto: CreateBudgetDto, principal: Principal) {
    if (dto.periodEnd < dto.periodStart) {
      throw this.errors.validation([
        { path: 'periodEnd', message: 'The period ends before it starts' },
      ]);
    }
    const row = await this.finance.createBudget(dto);
    await this.activity.recordSafe({
      principal,
      entityType: 'transaction',
      entityId: row.id,
      projectId: row.projectId,
      action: 'finance.budget_created',
      summary: `${row.name}: ${row.amount} ${row.currency}`,
    });
    return row;
  }

  /** Budgets at or past their alert threshold. */
  async budgetsAtRisk() {
    const { rows } = await this.finance.listBudgets({ page: 1, limit: 500 });
    return rows
      .map((b) => {
        const spent = Number(b.spentAmount);
        const total = Number(b.amount);
        const pct = total > 0 ? Math.round((spent / total) * 100) : 0;
        return { budget: b, usedPct: pct };
      })
      .filter((b) => b.usedPct >= b.budget.alertThresholdPct);
  }

  // --- reporting ---

  /**
   * Income and expense over a period.
   *
   * Income is reported alongside spending, from the same index, rather than
   * being derived by filtering an expense report.
   */
  async summary(from: string, to: string, projectId?: string) {
    const totals = await this.ledger.totalsByKind(from, to, projectId);
    const income = totals.find((t) => t.kind === 'income')?.total ?? '0';
    const expense = totals.find((t) => t.kind === 'expense')?.total ?? '0';
    return {
      from,
      to,
      income,
      expense,
      net: sum([income, `-${expense}`]),
      byKind: totals,
    };
  }

  categoryBreakdown(from: string, to: string, kind: TransactionRow['kind']) {
    return this.ledger.totalsByCategory(from, to, kind);
  }

  /**
   * Apply a posting's effects to the account balance and any matching budget.
   *
   * `sign` is 1 when settling and -1 when un-settling, so one code path handles
   * both directions and they cannot drift apart.
   */
  private async applyEffects(
    row: TransactionRow,
    sign: 1 | -1,
    tx: Parameters<Parameters<DrizzleDB['transaction']>[0]>[0],
  ): Promise<void> {
    const magnitude = row.amount;
    const signed =
      row.kind === 'income'
        ? magnitude
        : row.kind === 'expense'
          ? `-${magnitude}`
          : '0';

    if (row.kind === 'transfer' && row.counterAccountId) {
      await this.finance.adjustBalance(
        row.accountId,
        sign === 1 ? `-${magnitude}` : magnitude,
        tx,
      );
      await this.finance.adjustBalance(
        row.counterAccountId,
        sign === 1 ? magnitude : `-${magnitude}`,
        tx,
      );
    } else if (signed !== '0') {
      await this.finance.adjustBalance(
        row.accountId,
        sign === 1
          ? signed
          : signed.startsWith('-')
            ? signed.slice(1)
            : `-${signed}`,
        tx,
      );
    }

    // Only spending consumes a budget; income against a budget is not a thing.
    if (row.kind !== 'expense') return;
    const matching = await this.finance.budgetsMatching({
      projectId: row.projectId,
      categoryId: row.categoryId,
      occurredOn: row.occurredOn,
    });
    for (const budget of matching) {
      await this.finance.adjustBudgetSpend(
        budget.id,
        sign === 1 ? magnitude : `-${magnitude}`,
        tx,
      );
    }
  }

  private async requireAccount(id: string) {
    const account = await this.finance.findAccount(id);
    if (!account) {
      throw this.errors.create(ErrorCode.NOT_FOUND, {
        message: 'Financial account not found',
      });
    }
    return account;
  }
}
