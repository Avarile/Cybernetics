import { UsageError } from '../../core/errors';
import { FinanceTxCommand } from './finance-tx.command';

describe('FinanceTxCommand', () => {
  it('prints help when run with no subcommand', async () => {
    const help = jest.fn();
    const cmd = new FinanceTxCommand();
    cmd.setCommand({ help } as never);

    await cmd.run([]);

    expect(help).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown subcommand instead of printing help', async () => {
    const help = jest.fn();
    const cmd = new FinanceTxCommand();
    cmd.setCommand({
      help,
      name: () => 'tx',
      parent: null,
      commands: [{ name: () => 'ls' }],
    } as never);

    await expect(cmd.run(['nope'])).rejects.toThrow(UsageError);
    expect(help).not.toHaveBeenCalled();
  });
});
