import { CommandRunner, SubCommand } from 'nest-commander';
import { TasksTimeLogCommand } from './tasks-time-log.command';
import { TasksTimeLsCommand } from './tasks-time-ls.command';

@SubCommand({
  name: 'time',
  description: 'Manage logged time',
  subCommands: [TasksTimeLsCommand, TasksTimeLogCommand],
})
export class TasksTimeCommand extends CommandRunner {
  async run(): Promise<void> {
    this.command.help();
  }
}
