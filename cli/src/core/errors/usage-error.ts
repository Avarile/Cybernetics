import { ExitCode } from './api-error';

/**
 * A mistake the user can fix themselves — an unknown profile, a bad flag
 * combination, malformed input — as opposed to `ApiError` (the server said
 * no) or a bare `Error` (something we didn't expect). `reportError` maps it
 * to `ExitCode.Usage` (2) rather than the generic `ExitCode.Failure` (1).
 */
export class UsageError extends Error {
  readonly exitCode = ExitCode.Usage;

  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}
