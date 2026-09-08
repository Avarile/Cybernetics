import { Command, CommandRunner } from 'nest-commander';
import { runGroup } from '../../core/cli/group';
import { TasksAddCommand } from './tasks-add.command';
import { TasksEditCommand } from './tasks-edit.command';
import { TasksGetCommand } from './tasks-get.command';
import { TasksLsCommand } from './tasks-ls.command';
import { TasksMvCommand } from './tasks-mv.command';
import { TasksRmCommand } from './tasks-rm.command';
import { TasksTimeLogCommand } from './tasks-time-log.command';
import { TasksTimeLsCommand } from './tasks-time-ls.command';
import { TasksTimeCommand } from './tasks-time.command';

@Command({
  name: 'tasks',
  description: 'Manage tasks',
  subCommands: [
    TasksLsCommand,
    TasksGetCommand,
    TasksAddCommand,
    TasksEditCommand,
    TasksRmCommand,
    TasksMvCommand,
    TasksTimeCommand,
  ],
})
export class TasksCommand extends CommandRunner {
  async run(params: string[]): Promise<void> {
    runGroup(this.command, params);
  }
}

export {
  TasksAddCommand,
  TasksEditCommand,
  TasksGetCommand,
  TasksLsCommand,
  TasksMvCommand,
  TasksRmCommand,
  TasksTimeCommand,
  TasksTimeLogCommand,
  TasksTimeLsCommand,
};
