import { Module } from '@nestjs/common';
import { LoginCommand } from './commands/auth/login.command';
import { LogoutCommand } from './commands/auth/logout.command';
import { SessionsCommand } from './commands/auth/sessions.command';
import { WhoamiCommand } from './commands/auth/whoami.command';
import {
  ConfigCommand,
  ProfileAddCommand,
  ProfileCommand,
  ProfileListCommand,
  ProfileUseCommand,
} from './commands/config/profile.command';
import { ContactsAddCommand } from './commands/contacts/contacts-add.command';
import {
  ContactsCategoryAddCommand,
  ContactsCategoryCommand,
  ContactsCategoryEditCommand,
  ContactsCategoryLsCommand,
  ContactsCategoryRmCommand,
} from './commands/contacts/contacts-category.command';
import { ContactsChannelAddCommand } from './commands/contacts/contacts-channel-add.command';
import { ContactsChannelLsCommand } from './commands/contacts/contacts-channel-ls.command';
import { ContactsChannelRmCommand } from './commands/contacts/contacts-channel-rm.command';
import { ContactsChannelCommand } from './commands/contacts/contacts-channel.command';
import { ContactsEditCommand } from './commands/contacts/contacts-edit.command';
import { ContactsGetCommand } from './commands/contacts/contacts-get.command';
import { ContactsInteractionsCommand } from './commands/contacts/contacts-interactions.command';
import { ContactsLogCommand } from './commands/contacts/contacts-log.command';
import { ContactsLsCommand } from './commands/contacts/contacts-ls.command';
import { ContactsRmCommand } from './commands/contacts/contacts-rm.command';
import {
  ContactsTypeAddCommand,
  ContactsTypeCommand,
  ContactsTypeEditCommand,
  ContactsTypeLsCommand,
  ContactsTypeRmCommand,
} from './commands/contacts/contacts-type.command';
import { ContactsCommand } from './commands/contacts/contacts.command';
import { CompaniesAddCommand } from './commands/companies/companies-add.command';
import { CompaniesEditCommand } from './commands/companies/companies-edit.command';
import { CompaniesGetCommand } from './commands/companies/companies-get.command';
import { CompaniesLsCommand } from './commands/companies/companies-ls.command';
import { CompaniesRmCommand } from './commands/companies/companies-rm.command';
import { CompaniesCommand } from './commands/companies/companies.command';
import { FinanceAccountsAddCommand } from './commands/finance/finance-accounts-add.command';
import { FinanceAccountsCommand, FinanceAccountsLsCommand } from './commands/finance/finance-accounts.command';
import { FinanceBudgetsAddCommand } from './commands/finance/finance-budgets-add.command';
import { FinanceBudgetsAtRiskCommand } from './commands/finance/finance-budgets-at-risk.command';
import { FinanceBudgetsCommand, FinanceBudgetsLsCommand } from './commands/finance/finance-budgets.command';
import { FinanceRecurringAddCommand } from './commands/finance/finance-recurring-add.command';
import { FinanceRecurringLsCommand } from './commands/finance/finance-recurring-ls.command';
import { FinanceRecurringRmCommand } from './commands/finance/finance-recurring-rm.command';
import { FinanceRecurringCommand } from './commands/finance/finance-recurring.command';
import { FinanceReportForecastCommand } from './commands/finance/finance-report-forecast.command';
import { FinanceReportIncomeCommand } from './commands/finance/finance-report-income.command';
import { FinanceReportSpendCommand } from './commands/finance/finance-report-spend.command';
import { FinanceReportSummaryCommand } from './commands/finance/finance-report-summary.command';
import { FinanceReportCommand } from './commands/finance/finance-report.command';
import { FinanceTxAddCommand } from './commands/finance/finance-tx-add.command';
import { FinanceTxGetCommand } from './commands/finance/finance-tx-get.command';
import { FinanceTxLsCommand } from './commands/finance/finance-tx-ls.command';
import { FinanceTxReverseCommand } from './commands/finance/finance-tx-reverse.command';
import { FinanceTxStatusCommand } from './commands/finance/finance-tx-status.command';
import { FinanceTxCommand } from './commands/finance/finance-tx.command';
import { FinanceCommand } from './commands/finance/finance.command';
import { InvoicesAddCommand } from './commands/invoices/invoices-add.command';
import { InvoicesBillTimeCommand } from './commands/invoices/invoices-bill-time.command';
import { InvoicesGetCommand } from './commands/invoices/invoices-get.command';
import { InvoicesIssueCommand } from './commands/invoices/invoices-issue.command';
import { InvoicesLineAddCommand } from './commands/invoices/invoices-line-add.command';
import { InvoicesLineCommand } from './commands/invoices/invoices-line.command';
import { InvoicesLsCommand } from './commands/invoices/invoices-ls.command';
import { InvoicesOverdueCommand } from './commands/invoices/invoices-overdue.command';
import { InvoicesCommand } from './commands/invoices/invoices.command';
import { KnowledgeAddCommand } from './commands/knowledge/knowledge-add.command';
import {
  KnowledgeCategoryAddCommand,
  KnowledgeCategoryCommand,
  KnowledgeCategoryEditCommand,
  KnowledgeCategoryLsCommand,
  KnowledgeCategoryRmCommand,
} from './commands/knowledge/knowledge-category.command';
import { KnowledgeEditCommand } from './commands/knowledge/knowledge-edit.command';
import { KnowledgeGetCommand } from './commands/knowledge/knowledge-get.command';
import { KnowledgeLsCommand } from './commands/knowledge/knowledge-ls.command';
import { KnowledgePublishCommand } from './commands/knowledge/knowledge-publish.command';
import { KnowledgeRmCommand } from './commands/knowledge/knowledge-rm.command';
import {
  KnowledgeTypeAddCommand,
  KnowledgeTypeCommand,
  KnowledgeTypeEditCommand,
  KnowledgeTypeLsCommand,
  KnowledgeTypeRmCommand,
} from './commands/knowledge/knowledge-type.command';
import { KnowledgeCommand } from './commands/knowledge/knowledge.command';
import { ProjectsAddCommand } from './commands/projects/projects-add.command';
import { ProjectsEditCommand } from './commands/projects/projects-edit.command';
import { ProjectsGetCommand } from './commands/projects/projects-get.command';
import { ProjectsLsCommand } from './commands/projects/projects-ls.command';
import { ProjectsMemberAddCommand } from './commands/projects/projects-member-add.command';
import { ProjectsMemberRmCommand } from './commands/projects/projects-member-rm.command';
import { ProjectsMemberCommand } from './commands/projects/projects-member.command';
import { ProjectsMilestoneAddCommand } from './commands/projects/projects-milestone-add.command';
import { ProjectsMilestoneEditCommand } from './commands/projects/projects-milestone-edit.command';
import { ProjectsMilestoneLsCommand } from './commands/projects/projects-milestone-ls.command';
import { ProjectsMilestoneRmCommand } from './commands/projects/projects-milestone-rm.command';
import { ProjectsMilestoneCommand } from './commands/projects/projects-milestone.command';
import { ProjectsRmCommand } from './commands/projects/projects-rm.command';
import { ProjectsCommand } from './commands/projects/projects.command';
import { TasksAddCommand } from './commands/tasks/tasks-add.command';
import { TasksEditCommand } from './commands/tasks/tasks-edit.command';
import { TasksGetCommand } from './commands/tasks/tasks-get.command';
import { TasksLsCommand } from './commands/tasks/tasks-ls.command';
import { TasksMvCommand } from './commands/tasks/tasks-mv.command';
import { TasksRmCommand } from './commands/tasks/tasks-rm.command';
import { TasksTimeLogCommand } from './commands/tasks/tasks-time-log.command';
import { TasksTimeLsCommand } from './commands/tasks/tasks-time-ls.command';
import { TasksTimeCommand } from './commands/tasks/tasks-time.command';
import { TasksCommand } from './commands/tasks/tasks.command';
import { TagsAddCommand } from './commands/tags/tags-add.command';
import { TagsEditCommand } from './commands/tags/tags-edit.command';
import { TagsLsCommand } from './commands/tags/tags-ls.command';
import { TagsRmCommand } from './commands/tags/tags-rm.command';
import { TagsCommand } from './commands/tags/tags.command';
import { ConfigStore } from './core/config/config.store';
import { SettingsService } from './core/config/settings.service';
import { ClientFactory, sessionServiceFactory } from './core/http/client.factory';
import { SessionService } from './core/session/session.service';

@Module({
  providers: [
    ConfigStore,
    SettingsService,
    ClientFactory,
    { provide: SessionService, useFactory: sessionServiceFactory },
    ConfigCommand,
    ProfileCommand,
    ProfileAddCommand,
    ProfileUseCommand,
    ProfileListCommand,
    LoginCommand,
    LogoutCommand,
    WhoamiCommand,
    SessionsCommand,
    KnowledgeCommand,
    KnowledgeLsCommand,
    KnowledgeGetCommand,
    KnowledgeAddCommand,
    KnowledgeEditCommand,
    KnowledgePublishCommand,
    KnowledgeRmCommand,
    KnowledgeTypeCommand,
    KnowledgeTypeLsCommand,
    KnowledgeTypeAddCommand,
    KnowledgeTypeEditCommand,
    KnowledgeTypeRmCommand,
    KnowledgeCategoryCommand,
    KnowledgeCategoryLsCommand,
    KnowledgeCategoryAddCommand,
    KnowledgeCategoryEditCommand,
    KnowledgeCategoryRmCommand,
    ContactsCommand,
    ContactsLsCommand,
    ContactsGetCommand,
    ContactsAddCommand,
    ContactsEditCommand,
    ContactsRmCommand,
    ContactsChannelCommand,
    ContactsChannelLsCommand,
    ContactsChannelAddCommand,
    ContactsChannelRmCommand,
    ContactsLogCommand,
    ContactsInteractionsCommand,
    ContactsTypeCommand,
    ContactsTypeLsCommand,
    ContactsTypeAddCommand,
    ContactsTypeEditCommand,
    ContactsTypeRmCommand,
    ContactsCategoryCommand,
    ContactsCategoryLsCommand,
    ContactsCategoryAddCommand,
    ContactsCategoryEditCommand,
    ContactsCategoryRmCommand,
    FinanceCommand,
    FinanceAccountsCommand,
    FinanceAccountsAddCommand,
    FinanceAccountsLsCommand,
    FinanceTxCommand,
    FinanceTxLsCommand,
    FinanceTxGetCommand,
    FinanceTxAddCommand,
    FinanceTxStatusCommand,
    FinanceTxReverseCommand,
    FinanceBudgetsCommand,
    FinanceBudgetsAddCommand,
    FinanceBudgetsAtRiskCommand,
    FinanceBudgetsLsCommand,
    FinanceRecurringCommand,
    FinanceRecurringLsCommand,
    FinanceRecurringAddCommand,
    FinanceRecurringRmCommand,
    FinanceReportCommand,
    FinanceReportSummaryCommand,
    FinanceReportForecastCommand,
    FinanceReportIncomeCommand,
    FinanceReportSpendCommand,
    InvoicesCommand,
    InvoicesLsCommand,
    InvoicesOverdueCommand,
    InvoicesGetCommand,
    InvoicesAddCommand,
    InvoicesLineCommand,
    InvoicesLineAddCommand,
    InvoicesIssueCommand,
    InvoicesBillTimeCommand,
    ProjectsCommand,
    ProjectsLsCommand,
    ProjectsGetCommand,
    ProjectsAddCommand,
    ProjectsEditCommand,
    ProjectsRmCommand,
    ProjectsMemberCommand,
    ProjectsMemberAddCommand,
    ProjectsMemberRmCommand,
    ProjectsMilestoneCommand,
    ProjectsMilestoneLsCommand,
    ProjectsMilestoneAddCommand,
    ProjectsMilestoneEditCommand,
    ProjectsMilestoneRmCommand,
    TasksCommand,
    TasksLsCommand,
    TasksGetCommand,
    TasksAddCommand,
    TasksEditCommand,
    TasksRmCommand,
    TasksMvCommand,
    TasksTimeCommand,
    TasksTimeLsCommand,
    TasksTimeLogCommand,
    TagsCommand,
    TagsLsCommand,
    TagsAddCommand,
    TagsEditCommand,
    TagsRmCommand,
    CompaniesCommand,
    CompaniesLsCommand,
    CompaniesGetCommand,
    CompaniesAddCommand,
    CompaniesEditCommand,
    CompaniesRmCommand,
  ],
})
export class AppModule {}
