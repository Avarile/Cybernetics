import { AppException } from '../app-exception';
import { ErrorCode } from '../error-codes';
import { SearchEngineError } from '../../search-engine/search-engine.interface';
import { NoActiveEmailConfigError } from '../../email/email.types';

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNRESET',
]);
const REDIS_ERROR_NAMES = new Set([
  'MaxRetriesPerRequestError',
  'ClusterAllFailedError',
]);

/**
 * Normalizes raw driver/SDK errors at the boundary. Returns null when the error
 * is not a recognized infrastructure failure (the caller then falls back to
 * INTERNAL_ERROR). Detection is deliberately conservative and heuristic; precise
 * per-dependency attribution is a v2 concern.
 */
export function mapInfraError(err: unknown): AppException | null {
  if (err instanceof SearchEngineError) {
    return new AppException(ErrorCode.SEARCH_UNAVAILABLE, { cause: err });
  }
  if (err instanceof NoActiveEmailConfigError) {
    return new AppException(ErrorCode.MAIL_CONFIG_MISSING, { cause: err });
  }

  const anyErr = err as { code?: unknown; name?: unknown };
  const code = typeof anyErr?.code === 'string' ? anyErr.code : undefined;
  const name = typeof anyErr?.name === 'string' ? anyErr.name : undefined;

  // Postgres (pg driver SQLSTATE codes)
  if (code === '23505')
    return new AppException(ErrorCode.CONFLICT, { cause: err });
  if (
    code &&
    (code.startsWith('08') || code.startsWith('53') || code.startsWith('57'))
  ) {
    return new AppException(ErrorCode.DB_UNAVAILABLE, { cause: err });
  }

  // Object storage (MinIO / S3)
  if (code === 'NoSuchKey' || code === 'NotFound') {
    return new AppException(ErrorCode.STORAGE_OBJECT_NOT_FOUND, { cause: err });
  }

  // Redis / ioredis
  if (name && REDIS_ERROR_NAMES.has(name)) {
    return new AppException(ErrorCode.CACHE_UNAVAILABLE, { cause: err });
  }

  // Crypto (AES-GCM)
  if (
    err instanceof Error &&
    (/Malformed encryption envelope/i.test(err.message) ||
      /unable to authenticate data/i.test(err.message))
  ) {
    return new AppException(ErrorCode.CRYPTO_DECRYPT_FAILED, { cause: err });
  }

  // Generic network failure to a backing service
  if (code && NETWORK_CODES.has(code)) {
    return new AppException(ErrorCode.DEPENDENCY_UNAVAILABLE, { cause: err });
  }

  return null;
}
