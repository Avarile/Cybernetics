import { UsageError } from '../../core/errors';
import { FinanceCommand } from './finance.command';

describe('FinanceCommand', () => {
  it('prints help when run with no subcommand', async () => {
    const help = jest.fn();
    const cmd = new FinanceCommand();
    cmd.setCommand({ help } as never);

    await cmd.run([]);

    expect(help).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown subcommand instead of printing help', async () => {
    const help = jest.fn();
    const cmd = new FinanceCommand();
    cmd.setCommand({
      help,
      name: () => 'finance',
      parent: null,
      commands: [{ name: () => 'ls' }],
    } as never);

    await expect(cmd.run(['nope'])).rejects.toThrow(UsageError);
    expect(help).not.toHaveBeenCalled();
  });
});
