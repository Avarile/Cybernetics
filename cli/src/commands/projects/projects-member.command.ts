import { CommandRunner, SubCommand } from 'nest-commander';
import { ProjectsMemberAddCommand } from './projects-member-add.command';
import { ProjectsMemberRmCommand } from './projects-member-rm.command';

@SubCommand({
  name: 'member',
  description: "Manage a project's members",
  subCommands: [ProjectsMemberAddCommand, ProjectsMemberRmCommand],
})
export class ProjectsMemberCommand extends CommandRunner {
  async run(): Promise<void> {
    this.command.help();
  }
}
