import { Command, CommandRunner } from 'nest-commander';
import { runGroup } from '../../core/cli/group';
import { CompaniesAddCommand } from './companies-add.command';
import { CompaniesEditCommand } from './companies-edit.command';
import { CompaniesGetCommand } from './companies-get.command';
import { CompaniesLsCommand } from './companies-ls.command';
import { CompaniesRmCommand } from './companies-rm.command';

@Command({
  name: 'companies',
  description: 'Manage companies',
  subCommands: [
    CompaniesLsCommand,
    CompaniesGetCommand,
    CompaniesAddCommand,
    CompaniesEditCommand,
    CompaniesRmCommand,
  ],
})
export class CompaniesCommand extends CommandRunner {
  async run(params: string[]): Promise<void> {
    runGroup(this.command, params);
  }
}

export { CompaniesAddCommand, CompaniesEditCommand, CompaniesGetCommand, CompaniesLsCommand, CompaniesRmCommand };
