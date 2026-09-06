import { InvoicesLineCommand } from './invoices-line.command';

describe('InvoicesLineCommand', () => {
  it('prints help when run with no subcommand', async () => {
    const help = jest.fn();
    const cmd = new InvoicesLineCommand();
    cmd.setCommand({ help } as never);

    await cmd.run();

    expect(help).toHaveBeenCalledTimes(1);
  });
});
