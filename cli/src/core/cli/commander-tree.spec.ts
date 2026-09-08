import { prepareCommandTree, type CommanderCommand } from './commander-tree';

interface FakeCommand extends CommanderCommand {
  readonly label: string;
  readonly commands: FakeCommand[];
  exitCallback?: (err: unknown) => never;
  positional?: boolean;
}

function fake(label: string, children: FakeCommand[] = []): FakeCommand {
  const command: FakeCommand = {
    label,
    commands: children,
    exitOverride(callback) {
      command.exitCallback = callback;
      return command;
    },
    enablePositionalOptions(positional) {
      command.positional = positional;
      return command;
    },
  };
  return command;
}

/** Every node in `root`, depth-first. */
function flatten(root: FakeCommand): FakeCommand[] {
  return [root, ...root.commands.flatMap(flatten)];
}

describe('prepareCommandTree', () => {
  const onExit = (err: unknown): never => {
    throw err;
  };

  // The real shape: cyb -> finance -> accounts -> ls, three levels deep.
  const build = () =>
    fake('cyb', [
      fake('finance', [
        fake('accounts', [fake('ls'), fake('add')]),
        fake('budgets', [fake('ls'), fake('at-risk')]),
      ]),
      fake('contacts', [fake('ls')]),
    ]);

  it('installs the exit callback on every command, not just the root', () => {
    const root = build();
    prepareCommandTree(root, onExit);

    // nest-commander's errorHandler option reaches the root alone, which left
    // Commander calling process.exit(1) for anything a subcommand rejected.
    for (const command of flatten(root)) {
      expect(command.exitCallback).toBe(onExit);
    }
  });

  it('enables positional options on every command, including the root', () => {
    const root = build();
    prepareCommandTree(root, onExit);

    // The root is the one that matters: without it the root splits argv up
    // front and a parent declaring the same flag as its child swallows it.
    for (const command of flatten(root)) {
      expect(command.positional).toBe(true);
    }
  });

  it('reaches the deepest leaves', () => {
    const root = build();
    prepareCommandTree(root, onExit);

    const financeAccountsLs = root.commands[0].commands[0].commands[0];
    expect(financeAccountsLs.label).toBe('ls');
    expect(financeAccountsLs.positional).toBe(true);
    expect(financeAccountsLs.exitCallback).toBe(onExit);
  });

  it('handles a command with no subcommands', () => {
    const leaf = fake('whoami');
    expect(() => prepareCommandTree(leaf, onExit)).not.toThrow();
    expect(leaf.positional).toBe(true);
  });

  it('visits every command exactly once', () => {
    const root = build();
    // Identity, not label: `ls` legitimately appears under accounts, budgets
    // and contacts, so counting names would report false duplicates.
    const seen: FakeCommand[] = [];
    const all = flatten(root);
    for (const command of all) {
      const original = command.exitOverride.bind(command);
      command.exitOverride = (callback) => {
        seen.push(command);
        return original(callback);
      };
    }

    prepareCommandTree(root, onExit);

    expect(seen).toHaveLength(all.length);
    expect(new Set(seen).size).toBe(all.length);
  });
});
