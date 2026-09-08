import { CommandRunner, SubCommand } from 'nest-commander';
import { runGroup } from '../../core/cli/group';
import { InvoicesLineAddCommand } from './invoices-line-add.command';

@SubCommand({ name: 'line', description: 'Manage invoice line items', subCommands: [InvoicesLineAddCommand] })
export class InvoicesLineCommand extends CommandRunner {
  async run(params: string[]): Promise<void> {
    runGroup(this.command, params);
  }
}
