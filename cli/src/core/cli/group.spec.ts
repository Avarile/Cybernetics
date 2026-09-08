import { ExitCode, UsageError } from '../errors';
import { runGroup, type GroupCommand } from './group';

/** A stand-in for the Commander command nest-commander hands a group. */
function fakeCommand(
  name: string,
  subCommands: string[],
  parent: GroupCommand | null = null,
): GroupCommand & { helped: boolean } {
  const command = {
    helped: false,
    name: () => name,
    parent,
    commands: subCommands.map((s) => ({ name: () => s })),
    help: () => {
      command.helped = true;
    },
  };
  return command;
}

describe('runGroup', () => {
  it('prints help for a bare group invocation', () => {
    const command = fakeCommand('contacts', ['ls', 'get']);
    expect(() => runGroup(command, [])).not.toThrow();
    expect(command.helped).toBe(true);
  });

  it('treats a missing params array as a bare invocation', () => {
    const command = fakeCommand('contacts', ['ls']);
    expect(() => runGroup(command)).not.toThrow();
    expect(command.helped).toBe(true);
  });

  it('rejects an unknown subcommand instead of printing help', () => {
    const command = fakeCommand('contacts', ['ls', 'get']);
    expect(() => runGroup(command, ['lst'])).toThrow(UsageError);
    expect(command.helped).toBe(false);
  });

  it('exits 2 so a typo is never mistaken for success', () => {
    const command = fakeCommand('contacts', ['ls']);
    try {
      runGroup(command, ['lst']);
      throw new Error('expected runGroup to throw');
    } catch (err) {
      expect((err as UsageError).exitCode).toBe(ExitCode.Usage);
    }
  });

  it('names the typo, the command path and every valid subcommand', () => {
    const root = fakeCommand('cyb', ['contacts']);
    const command = fakeCommand('contacts', ['ls', 'get', 'add'], root);
    expect(() => runGroup(command, ['lst'])).toThrow(
      'Unknown subcommand "lst" for "cyb contacts". ' +
        'Valid subcommands: ls, get, add. See: cyb contacts --help',
    );
  });

  it('builds the path through every ancestor', () => {
    const root = fakeCommand('cyb', ['contacts']);
    const group = fakeCommand('contacts', ['channel'], root);
    const nested = fakeCommand('channel', ['ls', 'add', 'rm'], group);
    expect(() => runGroup(nested, ['list'])).toThrow(
      'Unknown subcommand "list" for "cyb contacts channel". ' +
        'Valid subcommands: ls, add, rm. See: cyb contacts channel --help',
    );
  });

  it('skips an unnamed root rather than emitting a leading space', () => {
    const root = fakeCommand('', ['contacts']);
    const command = fakeCommand('contacts', ['ls'], root);
    expect(() => runGroup(command, ['lst'])).toThrow(
      'Unknown subcommand "lst" for "contacts". Valid subcommands: ls. See: contacts --help',
    );
  });

  it('reports only the first excess argument', () => {
    const command = fakeCommand('tasks', ['ls'], null);
    expect(() => runGroup(command, ['tim', 'log'])).toThrow(/"tim"/);
  });
});
