import pc from 'picocolors';
import { ApiError, ExitCode } from './api-error';
import { UsageError } from './usage-error';

/**
 * Shape of the error nest-commander's `errorHandler` receives when Commander
 * itself detected the problem (unknown command, bad flag, `--help`,
 * `--version`) — it is always a `CommanderError`, already thrown after
 * Commander wrote its own output (the error line, or the requested help/
 * version text) directly to the console. Duck-typed rather than
 * `instanceof CommanderError` so this module doesn't need a direct
 * dependency on `commander` (a transitive dep of nest-commander).
 */
interface AlreadyReportedError {
  readonly code: string;
  readonly exitCode: number;
}

function isAlreadyReported(err: unknown): err is AlreadyReportedError {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { code?: unknown }).code === 'string' &&
    (err as { code: string }).code.startsWith('commander.') &&
    typeof (err as { exitCode?: unknown }).exitCode === 'number'
  );
}

/**
 * Renders any thrown value to stderr and returns the process exit code.
 *
 * `write` is injected so the behaviour is assertable without capturing the
 * real stderr.
 */
export function reportError(
  err: unknown,
  write: (s: string) => void,
): ExitCode {
  if (err instanceof ApiError) {
    write(`${pc.red('error')} ${err.message}\n`);

    for (const issue of err.issues) {
      write(`  ${pc.yellow(issue.path.join('.'))}: ${issue.message}\n`);
    }

    if (err.exitCode === ExitCode.AuthRequired) {
      write(`\nRun ${pc.bold('cyb login')} to authenticate.\n`);
    }

    if (err.correlationId) {
      write(pc.dim(`\ncorrelation id: ${err.correlationId}\n`));
    }

    return err.exitCode;
  }

  if (err instanceof UsageError) {
    write(`${pc.red('error')} ${err.message}\n`);
    return err.exitCode;
  }

  if (isAlreadyReported(err)) {
    // Commander already wrote this to the console before throwing it —
    // printing it again here would duplicate the line. Only the exit code
    // is ours to decide: 0 for --help/--version (already correct), and
    // ExitCode.Usage for everything else Commander itself rejected (an
    // unknown command, a missing or malformed flag, ...).
    return err.exitCode === 0 ? ExitCode.Ok : ExitCode.Usage;
  }

  const message = err instanceof Error ? err.message : String(err);
  write(`${pc.red('error')} ${message}\n`);
  return ExitCode.Failure;
}
