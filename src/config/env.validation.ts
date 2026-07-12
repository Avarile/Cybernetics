import { z } from 'zod';

/**
 * Coerces common truthy string representations into booleans.
 * `z.coerce.boolean()` is unsafe for env vars because `Boolean('false') === true`.
 */
const booleanFromEnv = z.preprocess(
  (value) => value === true || value === 'true' || value === '1',
  z.boolean(),
);

export const envSchema = z
  .object({
    // Application
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    APP_NAME: z.string().min(1).default('cybernetics'),

    // PostgreSQL
    DATABASE_HOST: z.string().min(1).default('localhost'),
    DATABASE_PORT: z.coerce.number().int().positive().default(5432),
    DATABASE_USER: z.string().min(1).default('postgres'),
    DATABASE_PASSWORD: z.string().default('postgres'),
    DATABASE_NAME: z.string().min(1).default('cybernetics'),
    DATABASE_SSL: booleanFromEnv.default(false),
    DATABASE_LOGGING: booleanFromEnv.default(false),

    // Redis (shared by cache, session cache, and BullMQ)
    REDIS_HOST: z.string().min(1).default('localhost'),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_PASSWORD: z.string().default(''),
    REDIS_DB: z.coerce.number().int().min(0).default(0),

    // Observability (Sentry)
    SENTRY_DSN: z.string().default(''),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
    SENTRY_PROFILES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

    // Logging
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    // MinIO / object storage
    MINIO_ENDPOINT: z.string().min(1).default('localhost'),
    MINIO_PORT: z.coerce.number().int().positive().default(9000),
    MINIO_USE_SSL: booleanFromEnv.default(false),
    MINIO_ACCESS_KEY: z.string().min(1).default('minioadmin'),
    MINIO_SECRET_KEY: z.string().min(1).default('minioadmin'),
    MINIO_REGION: z.string().min(1).default('us-east-1'),
    MINIO_BUCKET: z.string().min(1).default('cybernetics'),
    MINIO_PRESIGN_EXPIRY: z.coerce.number().int().positive().default(300),

    // File policy
    FILE_MAX_SIZE: z.coerce.number().int().positive().default(52_428_800),
    FILE_ALLOWED_MIME: z.string().default(''),
    FILE_PENDING_TTL: z.coerce.number().int().positive().default(3600),
  })
  .superRefine((env, ctx) => {
    // Refuse the well-known default MinIO credentials in production.
    if (
      env.NODE_ENV === 'production' &&
      env.MINIO_ACCESS_KEY === 'minioadmin' &&
      env.MINIO_SECRET_KEY === 'minioadmin'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MINIO_SECRET_KEY'],
        message:
          'Default MinIO credentials (minioadmin) are not allowed when NODE_ENV=production; set MINIO_ACCESS_KEY and MINIO_SECRET_KEY.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Passed to `ConfigModule.forRoot({ validate })`. Fails fast at boot with a
 * readable list of every invalid variable. Also used by the namespaced config
 * factories and the standalone seed runner so all coercion lives here.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(
        (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
      )
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}
