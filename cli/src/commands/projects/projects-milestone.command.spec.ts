import { ProjectsMilestoneCommand } from './projects-milestone.command';

describe('ProjectsMilestoneCommand', () => {
  it('prints help when run with no subcommand', async () => {
    const help = jest.fn();
    const cmd = new ProjectsMilestoneCommand();
    cmd.setCommand({ help } as never);

    await cmd.run();

    expect(help).toHaveBeenCalledTimes(1);
  });
});
