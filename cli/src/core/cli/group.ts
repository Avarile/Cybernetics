import { UsageError } from '../errors';

/**
 * The part of a Commander command this module needs. Structural rather than
 * `import { Command } from 'commander'` for the same reason
 * `errors/report.ts` duck-types `CommanderError`: commander is a transitive
 * dependency of nest-commander, not one this CLI declares.
 */
export interface GroupCommand {
  name(): string;
  readonly parent: GroupCommand | null;
  readonly commands: readonly { name(): string }[];
  /**
   * Writes help to stdout. Commander's own `help()` never returns — it exits,
   * or throws once an exit override is installed — but this is typed as
   * returning so control flow here does not depend on that.
   */
  help(): void;
}

/** `cyb contacts channel` — the full path a user would have to type. */
function commandPath(command: GroupCommand): string {
  const segments: string[] = [];
  for (let c: GroupCommand | null = command; c; c = c.parent) {
    const name = c.name();
    // Commander leaves the root's name empty until `parse()` derives it from
    // the script filename, so an empty segment is possible in a unit test.
    if (name) segments.unshift(name);
  }
  return segments.join(' ');
}

/**
 * Runs a group command — one that exists only to hold subcommands.
 *
 * Commander allows excess arguments by default, and a group that declares an
 * action handler is therefore handed a mistyped subcommand as a positional
 * argument rather than rejecting it. Printing help and returning would exit
 * 0, which makes `cyb contacts lst` indistinguishable from a command that
 * did something — the help text even goes to stdout, so a pipeline receives
 * it as data. Anything left in `params` is a subcommand name we do not have,
 * and is reported the way an unknown vocabulary key is: what was wrong, and
 * what would have been right.
 */
export function runGroup(command: GroupCommand, params: string[] = []): void {
  const [unknown] = params;

  if (unknown === undefined) {
    // The bare `cyb contacts`: help on stdout, exit 0. Deliberate, not a typo.
    command.help();
    return;
  }

  const path = commandPath(command);
  const valid = command.commands.map((c) => c.name()).join(', ');
  throw new UsageError(
    `Unknown subcommand "${unknown}" for "${path}". ` +
      `Valid subcommands: ${valid}. ` +
      `See: ${path} --help`,
  );
}
