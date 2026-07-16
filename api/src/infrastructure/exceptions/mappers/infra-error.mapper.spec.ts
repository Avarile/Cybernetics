import { ErrorCode } from '../error-codes';
import { mapInfraError } from './infra-error.mapper';
import { SearchEngineError } from '../../search-engine/search-engine.interface';
import { NoActiveEmailConfigError } from '../../email/email.types';

describe('mapInfraError', () => {
  it('maps a Postgres unique violation to CONFLICT', () => {
    const err = Object.assign(new Error('dup'), { code: '23505' });
    expect(mapInfraError(err)?.code).toBe(ErrorCode.CONFLICT);
  });

  it('maps a Postgres connection-class error to DB_UNAVAILABLE', () => {
    const err = Object.assign(new Error('down'), { code: '08006' });
    expect(mapInfraError(err)?.code).toBe(ErrorCode.DB_UNAVAILABLE);
  });

  it('maps SearchEngineError to SEARCH_UNAVAILABLE', () => {
    expect(mapInfraError(new SearchEngineError('meili down'))?.code).toBe(
      ErrorCode.SEARCH_UNAVAILABLE,
    );
  });

  it('maps NoActiveEmailConfigError to MAIL_CONFIG_MISSING', () => {
    expect(mapInfraError(new NoActiveEmailConfigError('IMAP'))?.code).toBe(
      ErrorCode.MAIL_CONFIG_MISSING,
    );
  });

  it('maps crypto envelope failures to CRYPTO_DECRYPT_FAILED', () => {
    expect(
      mapInfraError(new Error('Malformed encryption envelope.'))?.code,
    ).toBe(ErrorCode.CRYPTO_DECRYPT_FAILED);
    expect(
      mapInfraError(
        new Error('Unsupported state or unable to authenticate data'),
      )?.code,
    ).toBe(ErrorCode.CRYPTO_DECRYPT_FAILED);
  });

  it('maps a Redis MaxRetriesPerRequestError to CACHE_UNAVAILABLE', () => {
    const err = Object.assign(new Error('redis down'), {
      name: 'MaxRetriesPerRequestError',
    });
    expect(mapInfraError(err)?.code).toBe(ErrorCode.CACHE_UNAVAILABLE);
  });

  it('maps object-not-found and network errors', () => {
    expect(
      mapInfraError(Object.assign(new Error(), { code: 'NoSuchKey' }))?.code,
    ).toBe(ErrorCode.STORAGE_OBJECT_NOT_FOUND);
    expect(
      mapInfraError(Object.assign(new Error(), { code: 'ECONNREFUSED' }))?.code,
    ).toBe(ErrorCode.DEPENDENCY_UNAVAILABLE);
  });

  it('returns null for unrecognized errors', () => {
    expect(mapInfraError(new Error('mystery'))).toBeNull();
  });
});
