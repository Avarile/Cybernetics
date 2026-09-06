import { TasksCommand } from './tasks.command';

describe('TasksCommand', () => {
  it('prints help when run with no subcommand', async () => {
    const help = jest.fn();
    const cmd = new TasksCommand();
    cmd.setCommand({ help } as never);

    await cmd.run();

    expect(help).toHaveBeenCalledTimes(1);
  });
});
