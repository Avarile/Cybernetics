import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('applies defaults for a minimal environment', () => {
    const env = validateEnv({});
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.DATABASE_PORT).toBe(5432);
    expect(env.REDIS_HOST).toBe('localhost');
  });

  it('coerces numeric strings', () => {
    const env = validateEnv({ PORT: '8080', REDIS_PORT: '6380' });
    expect(env.PORT).toBe(8080);
    expect(env.REDIS_PORT).toBe(6380);
  });

  it('parses boolean-like strings without the Boolean("false") footgun', () => {
    expect(validateEnv({ DATABASE_SSL: 'false' }).DATABASE_SSL).toBe(false);
    expect(validateEnv({ DATABASE_SSL: 'true' }).DATABASE_SSL).toBe(true);
    expect(validateEnv({ DATABASE_SSL: '1' }).DATABASE_SSL).toBe(true);
  });

  it('throws with a readable message on invalid values', () => {
    expect(() => validateEnv({ PORT: 'not-a-number' })).toThrow(
      /Invalid environment variables/,
    );
    expect(() => validateEnv({ NODE_ENV: 'staging' })).toThrow(
      /Invalid environment variables/,
    );
  });
});
