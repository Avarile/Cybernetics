import { KnowledgeCommand } from './knowledge.command';

describe('KnowledgeCommand', () => {
  it('prints help when run with no subcommand', async () => {
    const help = jest.fn();
    const cmd = new KnowledgeCommand();
    cmd.setCommand({ help } as never);

    await cmd.run();

    expect(help).toHaveBeenCalledTimes(1);
  });
});
