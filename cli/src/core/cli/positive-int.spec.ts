import { UsageError } from '../errors';
import { positiveInt } from './positive-int';

describe('positiveInt', () => {
  it('parses a positive integer string', () => {
    expect(positiveInt('--limit', '20')).toBe(20);
  });

  it('rejects zero', () => {
    expect(() => positiveInt('--limit', '0')).toThrow(UsageError);
  });

  it('rejects a negative number', () => {
    expect(() => positiveInt('--page', '-1')).toThrow(UsageError);
  });

  it('rejects a non-integer', () => {
    expect(() => positiveInt('--page', '1.5')).toThrow(UsageError);
  });

  it('rejects non-numeric input, naming the flag and value', () => {
    expect(() => positiveInt('--page', 'abc')).toThrow('--page must be a positive integer, got "abc".');
  });
});
