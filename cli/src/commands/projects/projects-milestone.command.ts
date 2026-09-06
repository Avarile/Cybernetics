import { CommandRunner, SubCommand } from 'nest-commander';
import { ProjectsMilestoneAddCommand } from './projects-milestone-add.command';
import { ProjectsMilestoneEditCommand } from './projects-milestone-edit.command';
import { ProjectsMilestoneLsCommand } from './projects-milestone-ls.command';
import { ProjectsMilestoneRmCommand } from './projects-milestone-rm.command';

@SubCommand({
  name: 'milestone',
  description: "Manage a project's milestones",
  subCommands: [
    ProjectsMilestoneLsCommand,
    ProjectsMilestoneAddCommand,
    ProjectsMilestoneEditCommand,
    ProjectsMilestoneRmCommand,
  ],
})
export class ProjectsMilestoneCommand extends CommandRunner {
  async run(): Promise<void> {
    this.command.help();
  }
}
