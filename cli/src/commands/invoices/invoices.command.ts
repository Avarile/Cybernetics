import { Command, CommandRunner } from 'nest-commander';
import { runGroup } from '../../core/cli/group';
import { InvoicesAddCommand } from './invoices-add.command';
import { InvoicesBillTimeCommand } from './invoices-bill-time.command';
import { InvoicesGetCommand } from './invoices-get.command';
import { InvoicesIssueCommand } from './invoices-issue.command';
import { InvoicesLineAddCommand } from './invoices-line-add.command';
import { InvoicesLineCommand } from './invoices-line.command';
import { InvoicesLsCommand } from './invoices-ls.command';
import { InvoicesOverdueCommand } from './invoices-overdue.command';

@Command({
  name: 'invoices',
  description: 'Manage invoices',
  subCommands: [
    InvoicesLsCommand,
    InvoicesOverdueCommand,
    InvoicesGetCommand,
    InvoicesAddCommand,
    InvoicesLineCommand,
    InvoicesIssueCommand,
    InvoicesBillTimeCommand,
  ],
})
export class InvoicesCommand extends CommandRunner {
  async run(params: string[]): Promise<void> {
    runGroup(this.command, params);
  }
}

export {
  InvoicesAddCommand,
  InvoicesBillTimeCommand,
  InvoicesGetCommand,
  InvoicesIssueCommand,
  InvoicesLineAddCommand,
  InvoicesLineCommand,
  InvoicesLsCommand,
  InvoicesOverdueCommand,
};
