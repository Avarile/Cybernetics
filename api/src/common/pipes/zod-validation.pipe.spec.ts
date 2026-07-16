import { z } from 'zod';
import { AppException, ErrorCode } from '../../infrastructure/exceptions';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(z.object({ email: z.string().email() }));

  it('passes valid input through', () => {
    expect(pipe.transform({ email: 'a@b.co' })).toEqual({ email: 'a@b.co' });
  });

  it('throws an AppException(VALIDATION_FAILED) with issues on invalid input', () => {
    try {
      pipe.transform({ email: 'nope' });
      fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AppException);
      expect((e as AppException).code).toBe(ErrorCode.VALIDATION_FAILED);
      expect((e as AppException).details).toHaveProperty('issues');
    }
  });
});
