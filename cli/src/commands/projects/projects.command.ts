import { Command, CommandRunner } from 'nest-commander';
import { runGroup } from '../../core/cli/group';
import { ProjectsAddCommand } from './projects-add.command';
import { ProjectsEditCommand } from './projects-edit.command';
import { ProjectsGetCommand } from './projects-get.command';
import { ProjectsLsCommand } from './projects-ls.command';
import { ProjectsMemberAddCommand } from './projects-member-add.command';
import { ProjectsMemberRmCommand } from './projects-member-rm.command';
import { ProjectsMemberCommand } from './projects-member.command';
import { ProjectsMilestoneAddCommand } from './projects-milestone-add.command';
import { ProjectsMilestoneEditCommand } from './projects-milestone-edit.command';
import { ProjectsMilestoneLsCommand } from './projects-milestone-ls.command';
import { ProjectsMilestoneRmCommand } from './projects-milestone-rm.command';
import { ProjectsMilestoneCommand } from './projects-milestone.command';
import { ProjectsRmCommand } from './projects-rm.command';

@Command({
  name: 'projects',
  description: 'Manage projects',
  subCommands: [
    ProjectsLsCommand,
    ProjectsGetCommand,
    ProjectsAddCommand,
    ProjectsEditCommand,
    ProjectsRmCommand,
    ProjectsMemberCommand,
    ProjectsMilestoneCommand,
  ],
})
export class ProjectsCommand extends CommandRunner {
  async run(params: string[]): Promise<void> {
    runGroup(this.command, params);
  }
}

export {
  ProjectsAddCommand,
  ProjectsEditCommand,
  ProjectsGetCommand,
  ProjectsLsCommand,
  ProjectsMemberAddCommand,
  ProjectsMemberCommand,
  ProjectsMemberRmCommand,
  ProjectsMilestoneAddCommand,
  ProjectsMilestoneCommand,
  ProjectsMilestoneEditCommand,
  ProjectsMilestoneLsCommand,
  ProjectsMilestoneRmCommand,
  ProjectsRmCommand,
};
