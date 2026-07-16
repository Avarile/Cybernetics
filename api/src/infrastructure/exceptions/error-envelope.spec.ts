import { AppException } from './app-exception';
import { ErrorCode } from './error-codes';
import { buildEnvelope } from './error-envelope';

describe('buildEnvelope', () => {
  it('serializes a CLIENT error with its real message and details', () => {
    const err = new AppException(ErrorCode.USER_NOT_FOUND);
    const env = buildEnvelope(err, 'req-1', '/users/1');
    expect(env.error).toMatchObject({
      code: ErrorCode.USER_NOT_FOUND,
      message: 'User not found',
      statusCode: 404,
      correlationId: 'req-1',
      path: '/users/1',
    });
    expect(typeof env.error.timestamp).toBe('string');
  });

  it('hides the raw message of INTERNAL errors behind the safe registry message', () => {
    const err = new AppException(ErrorCode.AGENT_RUN_FAILED, {
      message: 'stacktrace: secret',
    });
    const env = buildEnvelope(err, 'req-2', '/chat');
    expect(env.error.statusCode).toBe(500);
    expect(env.error.message).toBe('The agent run failed');
    expect(env.error.message).not.toContain('secret');
  });
});
