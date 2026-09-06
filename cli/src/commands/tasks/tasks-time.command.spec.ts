import { TasksTimeCommand } from './tasks-time.command';

describe('TasksTimeCommand', () => {
  it('prints help when run with no subcommand', async () => {
    const help = jest.fn();
    const cmd = new TasksTimeCommand();
    cmd.setCommand({ help } as never);

    await cmd.run();

    expect(help).toHaveBeenCalledTimes(1);
  });
});
