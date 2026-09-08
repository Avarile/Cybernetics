import { UsageError } from '../../core/errors';
import { TagsCommand } from './tags.command';

describe('TagsCommand', () => {
  it('prints help when run with no subcommand', async () => {
    const help = jest.fn();
    const cmd = new TagsCommand();
    cmd.setCommand({ help } as never);

    await cmd.run([]);

    expect(help).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown subcommand instead of printing help', async () => {
    const help = jest.fn();
    const cmd = new TagsCommand();
    cmd.setCommand({
      help,
      name: () => 'tags',
      parent: null,
      commands: [{ name: () => 'ls' }],
    } as never);

    await expect(cmd.run(['nope'])).rejects.toThrow(UsageError);
    expect(help).not.toHaveBeenCalled();
  });
});
