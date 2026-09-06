import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module';
import { ProjectsModule } from '../projects/projects.module';
import { SharedModule } from '../shared/shared.module';
import { SystemModule } from '../system/system.module';
import { FinanceController } from './finance.controller';
import { FinanceRepository } from './finance.repository';
import { InvoiceController } from './invoice.controller';
import { InvoiceRepository } from './invoice.repository';
import { InvoiceService } from './invoice.service';
import { LedgerRepository } from './ledger.repository';
import { LedgerService } from './ledger.service';
import { RecurringService } from './recurring.service';

/**
 * Operational finance: accounts, the ledger, budgets, recurring income and
 * expenses, invoicing and payments.
 *
 * Depends on `ProjectsModule` for billable time and `ContactsModule` for the
 * bill-to snapshot — both are read through their services, so the scope rules
 * that guard them still apply.
 */
@Module({
  imports: [SharedModule, ContactsModule, ProjectsModule, SystemModule],
  controllers: [FinanceController, InvoiceController],
  providers: [
    FinanceRepository,
    LedgerRepository,
    InvoiceRepository,
    LedgerService,
    InvoiceService,
    RecurringService,
  ],
  exports: [LedgerService, InvoiceService, RecurringService],
})
export class FinanceModule {}
