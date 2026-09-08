/**
 * The part of a Commander command this module needs. Structural rather than
 * `import { Command } from 'commander'` for the same reason
 * `errors/report.ts` duck-types `CommanderError`: commander is a transitive
 * dependency of nest-commander, not one this CLI declares.
 */
export interface CommanderCommand {
  readonly commands: readonly CommanderCommand[];
  exitOverride(callback: (err: unknown) => never): unknown;
  enablePositionalOptions(positional: boolean): unknown;
}

/**
 * Applies the two Commander settings this CLI's exit-code and flag contracts
 * depend on to every command in the tree.
 *
 * nest-commander has an option for each, but neither reaches every command
 * that needs it, so both are set here instead — one pass, after the tree is
 * built and before argv is parsed.
 *
 * **Exit callback.** The `errorHandler` option reaches the root command only,
 * and nest-commander builds subcommands with Commander's `addCommand()` —
 * which, unlike `.command()`, does not `copyInheritedSettings()` — before
 * installing the handler at all. A subcommand is otherwise left with no exit
 * callback, so Commander's `_exit()` calls `process.exit(1)` directly for
 * anything it rejects and the mapping to `ExitCode.Usage` is never reached.
 * That is why `cyb --not-a-flag` exited 2 while `cyb contacts ls
 * --not-a-flag` exited 1.
 *
 * **Positional options.** These make an option bind to the command it
 * follows, so `cyb finance accounts ls --json` gives `--json` to `ls`. The
 * `enablePositionalOptions` option covers every built command but *not* the
 * root, and the root is the one that decides: without it the root splits all
 * of argv up front into operands (`finance accounts ls`) and unknown options
 * (`--json`), then passes that `--json` down the chain as an unknown for each
 * level to re-parse in turn. The first level that happens to declare `--json`
 * claims it — so `finance accounts`, which declares `--json` for its own bare
 * form, swallowed the flag and `ls` printed a table instead.
 */
export function prepareCommandTree(
  command: CommanderCommand,
  onExit: (err: unknown) => never,
): void {
  command.exitOverride(onExit);
  command.enablePositionalOptions(true);
  for (const child of command.commands) prepareCommandTree(child, onExit);
}
