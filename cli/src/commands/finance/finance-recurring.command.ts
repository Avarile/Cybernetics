import { CommandRunner, SubCommand } from 'nest-commander';
import { runGroup } from '../../core/cli/group';
import { FinanceRecurringAddCommand } from './finance-recurring-add.command';
import { FinanceRecurringLsCommand } from './finance-recurring-ls.command';
import { FinanceRecurringRmCommand } from './finance-recurring-rm.command';

@SubCommand({
  name: 'recurring',
  description: 'Manage recurring income and expenses',
  subCommands: [FinanceRecurringLsCommand, FinanceRecurringAddCommand, FinanceRecurringRmCommand],
})
export class FinanceRecurringCommand extends CommandRunner {
  async run(params: string[]): Promise<void> {
    runGroup(this.command, params);
  }
}
