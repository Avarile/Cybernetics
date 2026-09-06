import { FinanceTxCommand } from './finance-tx.command';

describe('FinanceTxCommand', () => {
  it('prints help when run with no subcommand', async () => {
    const help = jest.fn();
    const cmd = new FinanceTxCommand();
    cmd.setCommand({ help } as never);

    await cmd.run();

    expect(help).toHaveBeenCalledTimes(1);
  });
});
