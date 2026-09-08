export enum ExitCode {
  Ok = 0,
  Failure = 1,
  Usage = 2,
  AuthRequired = 3,
  NotFound = 4,
  Forbidden = 5,
  Conflict = 6,
}

/** One entry of the `details.issues` array the API sends for VALIDATION_FAILED. */
export interface ApiIssue {
  path: (string | number)[];
  message: string;
  code?: string;
}

const EXPIRED = 'AUTH_TOKEN_EXPIRED';
const SESSION_GONE = new Set(['AUTH_TOKEN_INVALID', 'AUTH_TOKEN_REUSE']);

/**
 * A token supplied through `CYB_TOKEN` that the API refused. Raised by the
 * CLI rather than received from the API: there is no refresh token behind a
 * supplied token, so nothing local can recover it. In the `AUTH_` namespace
 * so `exitCodeFor` maps it to ExitCode.AuthRequired.
 */
export const TOKEN_REJECTED = 'AUTH_TOKEN_REJECTED';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: ApiIssue[] = [],
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /**
   * Only an expiry is worth refreshing. INVALID and REUSE mean the session is
   * already gone server-side, and refreshing would spend the rotation budget
   * to be told so again.
   */
  isAuthExpiry(): boolean {
    return this.code === EXPIRED;
  }

  isSessionGone(): boolean {
    return SESSION_GONE.has(this.code);
  }

  get exitCode(): ExitCode {
    return exitCodeFor(this.code, this.status);
  }
}

export function exitCodeFor(code: string, status: number): ExitCode {
  if (code === 'VALIDATION_FAILED') return ExitCode.Usage;
  if (code.startsWith('AUTH_') || code === 'UNAUTHORIZED') {
    return ExitCode.AuthRequired;
  }
  // Fall through to the HTTP status, so a domain code added to the API after
  // this CLI was built still exits with something meaningful.
  switch (status) {
    case 400:
      return ExitCode.Usage;
    case 401:
      return ExitCode.AuthRequired;
    case 403:
      return ExitCode.Forbidden;
    case 404:
      return ExitCode.NotFound;
    case 409:
      return ExitCode.Conflict;
    default:
      return ExitCode.Failure;
  }
}
