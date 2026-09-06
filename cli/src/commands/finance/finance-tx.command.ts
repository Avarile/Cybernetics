import { CommandRunner, SubCommand } from 'nest-commander';
import { FinanceTxAddCommand } from './finance-tx-add.command';
import { FinanceTxGetCommand } from './finance-tx-get.command';
import { FinanceTxLsCommand } from './finance-tx-ls.command';
import { FinanceTxReverseCommand } from './finance-tx-reverse.command';
import { FinanceTxStatusCommand } from './finance-tx-status.command';

@SubCommand({
  name: 'tx',
  description: 'Manage transactions',
  subCommands: [
    FinanceTxLsCommand,
    FinanceTxGetCommand,
    FinanceTxAddCommand,
    FinanceTxStatusCommand,
    FinanceTxReverseCommand,
  ],
})
export class FinanceTxCommand extends CommandRunner {
  async run(): Promise<void> {
    this.command.help();
  }
}
