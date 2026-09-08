import { Command, CommandRunner } from 'nest-commander';
import { runGroup } from '../../core/cli/group';
import { FinanceAccountsCommand } from './finance-accounts.command';
import { FinanceBudgetsCommand } from './finance-budgets.command';
import { FinanceRecurringCommand } from './finance-recurring.command';
import { FinanceReportCommand } from './finance-report.command';
import { FinanceTxCommand } from './finance-tx.command';

@Command({
  name: 'finance',
  description: 'Manage accounts, the ledger, budgets, recurring schedules and reports',
  subCommands: [
    FinanceAccountsCommand,
    FinanceTxCommand,
    FinanceBudgetsCommand,
    FinanceRecurringCommand,
    FinanceReportCommand,
  ],
})
export class FinanceCommand extends CommandRunner {
  async run(params: string[]): Promise<void> {
    runGroup(this.command, params);
  }
}

export {
  FinanceAccountsCommand,
  FinanceBudgetsCommand,
  FinanceRecurringCommand,
  FinanceReportCommand,
  FinanceTxCommand,
};
