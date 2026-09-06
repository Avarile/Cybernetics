import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
  type DrizzleExecutor,
} from '../../infrastructure/database/drizzle.constants';
import {
  invoiceLineItems,
  invoices,
  payments,
  type InvoiceLineItemRow,
  type InvoiceRow,
  type NewInvoiceLineItemRow,
  type NewInvoiceRow,
  type NewPaymentRow,
  type PaymentRow,
} from '../../infrastructure/database/schema/finance.schema';

export interface InvoiceQuery {
  status?: InvoiceRow['status'];
  contactId?: string;
  companyId?: string;
  projectId?: string;
  page: number;
  limit: number;
}

@Injectable()
export class InvoiceRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<InvoiceRow | null> {
    const rows = await this.db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(q: InvoiceQuery): Promise<{ rows: InvoiceRow[]; total: number }> {
    const filters: SQL[] = [eq(invoices.isDeleted, false)];
    if (q.status) filters.push(eq(invoices.status, q.status));
    if (q.contactId) filters.push(eq(invoices.contactId, q.contactId));
    if (q.companyId) filters.push(eq(invoices.companyId, q.companyId));
    if (q.projectId) filters.push(eq(invoices.projectId, q.projectId));
    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(invoices)
      .where(where)
      .orderBy(desc(invoices.issueDate))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(invoices)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  /**
   * Allocate the next invoice number for a year, gaplessly.
   *
   * Serialized on a single advisory-locked read of the maximum, inside the
   * issuing transaction. Gapless numbering is an audit expectation in most
   * jurisdictions, so this must not race — two invoices sharing a number is a
   * far worse failure than a brief wait.
   */
  async nextNumber(
    prefix: string,
    executor: DrizzleExecutor = this.db,
  ): Promise<string> {
    // A transaction-scoped advisory lock keyed by the prefix: concurrent
    // issuers queue rather than both reading the same maximum.
    await executor.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${prefix}`}))`,
    );
    const result = await executor.execute<{ max: string | null }>(sql`
      SELECT MAX(NULLIF(regexp_replace(number, '^.*-', ''), '')::int)::text AS max
      FROM ${invoices}
      WHERE number LIKE ${`${prefix}-%`}
    `);
    const next = Number(result.rows[0]?.max ?? 0) + 1;
    return `${prefix}-${String(next).padStart(4, '0')}`;
  }

  async create(
    values: NewInvoiceRow,
    executor: DrizzleExecutor = this.db,
  ): Promise<InvoiceRow> {
    const rows = await executor.insert(invoices).values(values).returning();
    return rows[0];
  }

  async update(
    id: string,
    patch: Partial<NewInvoiceRow>,
    executor: DrizzleExecutor = this.db,
  ): Promise<InvoiceRow | null> {
    const rows = await executor
      .update(invoices)
      .set(patch)
      .where(and(eq(invoices.id, id), eq(invoices.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  /** Invoices past their due date and not settled — the reminder sweep. */
  overdue(today: string): Promise<InvoiceRow[]> {
    return this.db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.isDeleted, false),
          sql`${invoices.status} IN ('sent', 'partially_paid')`,
          sql`${invoices.dueDate} < ${today}`,
        ),
      );
  }

  // --- line items ---

  lineItems(invoiceId: string): Promise<InvoiceLineItemRow[]> {
    return this.db
      .select()
      .from(invoiceLineItems)
      .where(
        and(
          eq(invoiceLineItems.invoiceId, invoiceId),
          eq(invoiceLineItems.isDeleted, false),
        ),
      )
      .orderBy(asc(invoiceLineItems.sortOrder));
  }

  async addLineItem(
    values: NewInvoiceLineItemRow,
    executor: DrizzleExecutor = this.db,
  ): Promise<InvoiceLineItemRow> {
    const rows = await executor
      .insert(invoiceLineItems)
      .values(values)
      .returning();
    return rows[0];
  }

  async removeLineItem(id: string): Promise<boolean> {
    const rows = await this.db
      .update(invoiceLineItems)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(eq(invoiceLineItems.id, id), eq(invoiceLineItems.isDeleted, false)),
      )
      .returning({ id: invoiceLineItems.id });
    return rows.length > 0;
  }

  // --- payments ---

  listPayments(invoiceId: string): Promise<PaymentRow[]> {
    return this.db
      .select()
      .from(payments)
      .where(
        and(eq(payments.invoiceId, invoiceId), eq(payments.isDeleted, false)),
      )
      .orderBy(desc(payments.paidAt));
  }

  async addPayment(
    values: NewPaymentRow,
    executor: DrizzleExecutor = this.db,
  ): Promise<PaymentRow> {
    const rows = await executor.insert(payments).values(values).returning();
    return rows[0];
  }
}
