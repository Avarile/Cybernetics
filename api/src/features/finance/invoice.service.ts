import { Inject, Injectable, Logger } from '@nestjs/common';
import { userIdOrNull, type Principal } from '../../common/principal';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type {
  InvoiceRow,
  PaymentRow,
} from '../../infrastructure/database/schema/finance.schema';
import { ContactCompanyService } from '../contacts/contact-company.service';
import { ContactService } from '../contacts/contact.service';
import { ProjectLinkRepository } from '../projects/project-link.repository';
import { ActivityService } from '../shared/activity.service';
import type {
  AddLineItemDto,
  BillTimeDto,
  CreateInvoiceDto,
  ListInvoicesDto,
  RecordPaymentDto,
} from './dto/finance.dto';
import { InvoiceRepository } from './invoice.repository';
import { LedgerRepository } from './ledger.repository';
import { add, compare, multiply, percentOf, sum } from './money.util';

/** Minutes to hours, for billing logged time. */
const MINUTES_PER_HOUR = 60;

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly repo: InvoiceRepository,
    private readonly ledger: LedgerRepository,
    private readonly timeEntries: ProjectLinkRepository,
    private readonly contacts: ContactService,
    private readonly companies: ContactCompanyService,
    private readonly activity: ActivityService,
    private readonly errors: ExceptionService,
  ) {}

  async list(dto: ListInvoicesDto) {
    const { rows, total } = await this.repo.list(dto);
    return { data: rows, total, page: dto.page, limit: dto.limit };
  }

  async get(id: string): Promise<InvoiceRow> {
    const row = await this.repo.findById(id);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    return row;
  }

  async detail(id: string) {
    const invoice = await this.get(id);
    const [lineItems, payments] = await Promise.all([
      this.repo.lineItems(id),
      this.repo.listPayments(id),
    ]);
    return { invoice, lineItems, payments };
  }

  /**
   * Create a draft invoice.
   *
   * The bill-to details are snapshotted now, not resolved at render time: a
   * customer that moves must not retroactively change an invoice already
   * issued.
   */
  async create(
    dto: CreateInvoiceDto,
    principal: Principal,
  ): Promise<InvoiceRow> {
    const snapshot = await this.billToSnapshot(dto, principal);
    const row = await this.repo.create({
      ...dto,
      // Allocated at issue, not at creation: a draft that is never sent must
      // not consume a number, or the sequence gains gaps.
      number: `DRAFT-${Date.now()}`,
      billToSnapshot: snapshot,
      createdBy: userIdOrNull(principal),
    });
    await this.activity.recordSafe({
      principal,
      entityType: 'invoice',
      entityId: row.id,
      projectId: row.projectId,
      action: 'finance.invoice_created',
    });
    return row;
  }

  async addLineItem(
    invoiceId: string,
    dto: AddLineItemDto,
    principal: Principal,
  ) {
    const invoice = await this.requireDraft(invoiceId);
    const amount = multiply(dto.unitPrice, dto.quantity);
    const taxAmount = percentOf(amount, dto.taxRatePct);

    const item = await this.repo.addLineItem({
      invoiceId,
      description: dto.description,
      quantity: dto.quantity,
      unit: dto.unit,
      unitPrice: dto.unitPrice,
      taxRatePct: dto.taxRatePct,
      // Stored, not derived on read: rounding must not vary by reader.
      amount,
      taxAmount,
      total: add(amount, taxAmount),
      taskId: dto.taskId,
      projectId: dto.projectId ?? invoice.projectId,
    });
    await this.recalculate(invoiceId);
    await this.activity.recordSafe({
      principal,
      entityType: 'invoice',
      entityId: invoiceId,
      action: 'finance.invoice_line_added',
    });
    return item;
  }

  async removeLineItem(invoiceId: string, itemId: string): Promise<void> {
    await this.requireDraft(invoiceId);
    const removed = await this.repo.removeLineItem(itemId);
    if (!removed) throw this.errors.create(ErrorCode.NOT_FOUND);
    await this.recalculate(invoiceId);
  }

  /**
   * Turn logged time into an invoice line.
   *
   * Stamping `invoice_line_item_id` on each entry is the double-billing lock:
   * a billed entry disappears from `unbilledFor`, so the same hour cannot reach
   * a second invoice. Both writes share one transaction, because a line item
   * without its lock is exactly the failure the lock exists to prevent.
   */
  async billTime(invoiceId: string, dto: BillTimeDto, principal: Principal) {
    const invoice = await this.requireDraft(invoiceId);
    const available = await this.timeEntries.unbilledFor(dto.projectId);
    const byId = new Map(available.map((e) => [e.id, e]));

    const selected = dto.timeEntryIds.map((id) => {
      const entry = byId.get(id);
      if (!entry) {
        // Either it does not exist, is not billable, or is already invoiced —
        // all three are the same answer to the caller.
        throw this.errors.create(ErrorCode.CONFLICT, {
          message: `Time entry ${id} is not available to bill`,
        });
      }
      return entry;
    });

    const totalMinutes = selected.reduce((acc, e) => acc + e.minutes, 0);
    const hours = (totalMinutes / MINUTES_PER_HOUR).toFixed(4);
    const amount = multiply(dto.unitPrice, hours);
    const taxAmount = percentOf(amount, dto.taxRatePct);

    const item = await this.db.transaction(async (tx) => {
      const created = await this.repo.addLineItem(
        {
          invoiceId,
          description: dto.description,
          quantity: hours,
          unit: 'hour',
          unitPrice: dto.unitPrice,
          taxRatePct: dto.taxRatePct,
          amount,
          taxAmount,
          total: add(amount, taxAmount),
          projectId: dto.projectId,
        },
        tx,
      );
      // `tx`, not the bare connection: the line item and the locks it depends
      // on have to commit or roll back together.
      const claimed = await this.timeEntries.markBilled(
        selected.map((e) => e.id),
        created.id,
        tx,
      );
      // `unbilledFor` read these a moment ago; another bill may have claimed
      // them since. Claiming fewer than asked means exactly that, and rolling
      // back is the only answer that does not bill one piece of work twice.
      if (claimed.length !== selected.length) {
        throw this.errors.create(ErrorCode.CONFLICT, {
          message:
            'Some time entries were billed by another invoice; nothing was changed',
        });
      }
      return created;
    });

    await this.recalculate(invoiceId);
    await this.activity.recordSafe({
      principal,
      entityType: 'invoice',
      entityId: invoiceId,
      projectId: invoice.projectId,
      action: 'finance.time_billed',
      summary: `${totalMinutes} minutes across ${selected.length} entries`,
    });
    return item;
  }

  /**
   * Issue an invoice: allocate its number and freeze it.
   *
   * After this the invoice is read-only. Changes are a void plus a new invoice,
   * because an issued invoice is a document someone else holds a copy of.
   */
  async issue(id: string, principal: Principal): Promise<InvoiceRow> {
    const invoice = await this.requireDraft(id);
    const lineItems = await this.repo.lineItems(id);
    if (lineItems.length === 0) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: 'An invoice needs at least one line before it can be issued',
      });
    }

    const row = await this.db.transaction(async (tx) => {
      const prefix = `INV-${new Date(invoice.issueDate).getFullYear()}`;
      const number = await this.repo.nextNumber(prefix, tx);
      const updated = await this.repo.update(
        id,
        { number, status: 'sent', sentAt: new Date() },
        tx,
      );
      if (!updated) throw this.errors.create(ErrorCode.NOT_FOUND);
      return updated;
    });

    await this.activity.recordSafe({
      principal,
      entityType: 'invoice',
      entityId: id,
      projectId: row.projectId,
      action: 'finance.invoice_issued',
      summary: row.number,
    });
    return row;
  }

  async void(id: string, principal: Principal): Promise<InvoiceRow> {
    const invoice = await this.get(id);
    if (invoice.status === 'paid') {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: 'A paid invoice cannot be voided; refund it instead',
      });
    }
    const row = await this.repo.update(id, {
      status: 'void',
      voidedAt: new Date(),
    });
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    await this.activity.recordSafe({
      principal,
      entityType: 'invoice',
      entityId: id,
      action: 'finance.invoice_voided',
    });
    return row;
  }

  /**
   * Record a payment, optionally posting the matching ledger entry.
   *
   * The payment, the invoice's paid total and the ledger row all move together:
   * an invoice that says paid with nothing in the ledger behind it is how the
   * two halves of a finance module drift apart.
   */
  async recordPayment(
    invoiceId: string,
    dto: RecordPaymentDto,
    principal: Principal,
  ): Promise<PaymentRow> {
    const invoice = await this.get(invoiceId);
    if (invoice.status === 'draft' || invoice.status === 'void') {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: `Cannot pay a ${invoice.status} invoice`,
      });
    }
    if (dto.currency !== invoice.currency) {
      throw this.errors.validation([
        {
          path: 'currency',
          message: `Invoice is in ${invoice.currency}`,
        },
      ]);
    }

    const payment = await this.db.transaction(async (tx) => {
      let transactionId: string | null = null;
      if (dto.accountId) {
        const posted = await this.ledger.create(
          {
            kind: 'income',
            occurredOn: dto.paidAt.toISOString().slice(0, 10),
            amount: dto.amount,
            currency: dto.currency,
            accountId: dto.accountId,
            projectId: invoice.projectId,
            contactId: invoice.contactId,
            companyId: invoice.companyId,
            invoiceId,
            description: `Payment for ${invoice.number}`,
            reference: dto.reference,
            status: 'cleared',
            createdBy: userIdOrNull(principal),
          },
          tx,
        );
        transactionId = posted.id;
      }

      const created = await this.repo.addPayment(
        {
          invoiceId,
          transactionId,
          amount: dto.amount,
          currency: dto.currency,
          paidAt: dto.paidAt,
          method: dto.method,
          reference: dto.reference,
          recordedBy: userIdOrNull(principal),
        },
        tx,
      );

      const paid = add(invoice.amountPaid, dto.amount);
      const settled = compare(paid, invoice.total) >= 0;
      await this.repo.update(
        invoiceId,
        {
          amountPaid: paid,
          status: settled ? 'paid' : 'partially_paid',
          ...(settled ? { paidAt: dto.paidAt } : {}),
        },
        tx,
      );
      return created;
    });

    await this.activity.recordSafe({
      principal,
      entityType: 'invoice',
      entityId: invoiceId,
      projectId: invoice.projectId,
      action: 'finance.payment_recorded',
      summary: `${dto.amount} ${dto.currency}`,
    });
    return payment;
  }

  /** Invoices past due — the reminder sweep's input. */
  overdue() {
    return this.repo.overdue(new Date().toISOString().slice(0, 10));
  }

  /** Recompute the header totals from the lines, exactly. */
  private async recalculate(invoiceId: string): Promise<void> {
    const items = await this.repo.lineItems(invoiceId);
    const subtotal = sum(items.map((i) => i.amount));
    const taxTotal = sum(items.map((i) => i.taxAmount));
    await this.repo.update(invoiceId, {
      subtotal,
      taxTotal,
      total: add(subtotal, taxTotal),
    });
  }

  private async requireDraft(id: string): Promise<InvoiceRow> {
    const invoice = await this.get(id);
    if (invoice.status !== 'draft') {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: `Invoice ${invoice.number} is ${invoice.status} and is read-only`,
      });
    }
    return invoice;
  }

  /** Bill-to details as they stand now, frozen onto the invoice. */
  private async billToSnapshot(
    dto: CreateInvoiceDto,
    principal: Principal,
  ): Promise<Record<string, unknown>> {
    if (dto.companyId) {
      const company = await this.companies.get(dto.companyId);
      return {
        kind: 'company',
        name: company.legalName ?? company.name,
        address: company.address,
        taxNumber: company.taxNumber,
      };
    }
    const contact = await this.contacts.get(dto.contactId!, principal);
    return {
      kind: 'contact',
      name: contact.displayName,
      email: contact.primaryEmail,
    };
  }
}
