import { CommandRunner, SubCommand } from 'nest-commander';
import { InvoicesLineAddCommand } from './invoices-line-add.command';

@SubCommand({ name: 'line', description: 'Manage invoice line items', subCommands: [InvoicesLineAddCommand] })
export class InvoicesLineCommand extends CommandRunner {
  async run(): Promise<void> {
    this.command.help();
  }
}
