import { CommandRunner, SubCommand } from 'nest-commander';
import { runGroup } from '../../core/cli/group';
import { TasksTimeLogCommand } from './tasks-time-log.command';
import { TasksTimeLsCommand } from './tasks-time-ls.command';

@SubCommand({
  name: 'time',
  description: 'Manage logged time',
  subCommands: [TasksTimeLsCommand, TasksTimeLogCommand],
})
export class TasksTimeCommand extends CommandRunner {
  async run(params: string[]): Promise<void> {
    runGroup(this.command, params);
  }
}
