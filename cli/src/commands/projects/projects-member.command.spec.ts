import { UsageError } from '../../core/errors';
import { ProjectsMemberCommand } from './projects-member.command';

describe('ProjectsMemberCommand', () => {
  it('prints help when run with no subcommand', async () => {
    const help = jest.fn();
    const cmd = new ProjectsMemberCommand();
    cmd.setCommand({ help } as never);

    await cmd.run([]);

    expect(help).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown subcommand instead of printing help', async () => {
    const help = jest.fn();
    const cmd = new ProjectsMemberCommand();
    cmd.setCommand({
      help,
      name: () => 'member',
      parent: null,
      commands: [{ name: () => 'ls' }],
    } as never);

    await expect(cmd.run(['nope'])).rejects.toThrow(UsageError);
    expect(help).not.toHaveBeenCalled();
  });
});
