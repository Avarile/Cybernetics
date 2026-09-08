import { CommandRunner, SubCommand } from 'nest-commander';
import { runGroup } from '../../core/cli/group';
import { ProjectsMemberAddCommand } from './projects-member-add.command';
import { ProjectsMemberLsCommand } from './projects-member-ls.command';
import { ProjectsMemberRmCommand } from './projects-member-rm.command';

@SubCommand({
  name: 'member',
  description: "Manage a project's members",
  subCommands: [ProjectsMemberLsCommand, ProjectsMemberAddCommand, ProjectsMemberRmCommand],
})
export class ProjectsMemberCommand extends CommandRunner {
  async run(params: string[]): Promise<void> {
    runGroup(this.command, params);
  }
}
