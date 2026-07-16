import { HttpException } from '@nestjs/common';
import { ErrorCode, ErrorKind } from './error-codes';
import { ERROR_REGISTRY } from './error-registry';

export interface AppExceptionOptions {
  message?: string;
  details?: unknown;
  cause?: unknown;
}

/**
 * The single exception type the application throws. A plain class (constructable
 * without DI), so it works in non-DI contexts (pipes, standalone functions) as
 * well as via `ExceptionService`.
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly kind: ErrorKind;
  readonly details?: unknown;

  constructor(code: ErrorCode, opts: AppExceptionOptions = {}) {
    const spec = ERROR_REGISTRY[code];
    super(
      { code, message: opts.message ?? spec.message, details: opts.details },
      spec.status,
      { cause: opts.cause },
    );
    this.code = code;
    this.kind = spec.kind;
    this.details = opts.details;
  }
}
