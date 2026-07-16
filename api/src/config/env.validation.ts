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
    MINIO_HOST: z.string().min(1).default('localhost'),
    MINIO_PORT: z.coerce.number().int().positive().default(9000),
    MINIO_USE_SSL: booleanFromEnv.default(false),
    MINIO_ROOT_USER: z.string().min(1).default('minioadmin'),
    MINIO_ROOT_PASSWORD: z.string().min(1).default('minioadmin'),
    MINIO_REGION: z.string().min(1).default('us-east-1'),
    MINIO_BUCKET: z.string().min(1).default('cybernetics'),
    MINIO_PRESIGN_EXPIRY: z.coerce.number().int().positive().default(300),

    // File policy
    FILE_MAX_SIZE: z.coerce.number().int().positive().default(52_428_800),
    FILE_ALLOWED_MIME: z.string().default(''),
    FILE_PENDING_TTL: z.coerce.number().int().positive().default(3600),

    // MeiliSearch / search engine
    MEILISEARCH_HOST: z.string().min(1).default('localhost'),
    MEILISEARCH_PORT: z.coerce.number().int().positive().default(7700),
    MEILISEARCH_USE_SSL: booleanFromEnv.default(false),
    MEILISEARCH_MASTER_KEY: z.string().default(''),
    MEILISEARCH_INDEX_PREFIX: z.string().default(''),
    MEILISEARCH_TASK_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10_000),
    MEILISEARCH_SEARCH_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(5_000),
    SEARCH_DEFAULT_PAGE_SIZE: z.coerce.number().int().positive().default(20),
    SEARCH_MAX_PAGE_SIZE: z.coerce.number().int().positive().default(100),

    // Mastra AI agent
    AI_GATEWAY_API_KEY: z.string().default(''),
    MASTRA_MODEL: z.string().min(1).default('anthropic/claude-sonnet-4.6'),
    MASTRA_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
    MASTRA_MEMORY_LAST_MESSAGES: z.coerce.number().int().positive().default(20),
    MASTRA_APPROVAL_TTL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(86_400_000),
    MASTRA_SCHEDULES_ENABLED: booleanFromEnv.default(false),

    // Auth / JWT
    JWT_ACCESS_SECRET: z
      .string()
      .min(1)
      .default('dev-insecure-secret-change-me-please'),
    JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL: z.coerce.number().int().positive().default(604_800),
    AGENT_TOKEN_TTL: z.coerce.number().int().positive().default(900),
    JWT_ISSUER: z.string().min(1).default('cybernetics'),

    // Security
    THROTTLE_TTL: z.coerce.number().int().positive().default(60),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
    CORS_ORIGINS: z.string().default(''),

    // Auth seeding
    SEED_ADMIN_EMAIL: z.string().email().default('admin@cybernetics.local'),
    SEED_ADMIN_PASSWORD: z.string().default(''),

    // System module (secret encryption at rest)
    SYSTEM_ENCRYPTION_KEY: z
      .string()
      .default('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='), // 32 zero-bytes (dev/test only)
    SYSTEM_ENCRYPTION_KEY_VERSION: z.coerce
      .number()
      .int()
      .positive()
      .default(1),
  })
  .superRefine((env, ctx) => {
    // Refuse the well-known default MinIO credentials in production.
    if (
      env.NODE_ENV === 'production' &&
      env.MINIO_ROOT_USER === 'minioadmin' &&
      env.MINIO_ROOT_PASSWORD === 'minioadmin'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MINIO_ROOT_PASSWORD'],
        message:
          'Default MinIO credentials (minioadmin) are not allowed when NODE_ENV=production; set MINIO_ROOT_USER and MINIO_ROOT_PASSWORD.',
      });
    }

    // Require a master key in production.
    if (
      env.NODE_ENV === 'production' &&
      env.MEILISEARCH_MASTER_KEY.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MEILISEARCH_MASTER_KEY'],
        message: 'MEILISEARCH_MASTER_KEY is required when NODE_ENV=production.',
      });
    }

    if (
      env.NODE_ENV === 'production' &&
      (env.JWT_ACCESS_SECRET === 'dev-insecure-secret-change-me-please' ||
        env.JWT_ACCESS_SECRET.length < 32)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message:
          'JWT_ACCESS_SECRET must be a strong non-default value (>= 32 chars) when NODE_ENV=production.',
      });
    }

    if (env.NODE_ENV === 'production' && env.AI_GATEWAY_API_KEY.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AI_GATEWAY_API_KEY'],
        message: 'AI_GATEWAY_API_KEY is required when NODE_ENV=production.',
      });
    }

    if (env.NODE_ENV === 'production' && env.SEED_ADMIN_PASSWORD.length < 12) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SEED_ADMIN_PASSWORD'],
        message:
          'SEED_ADMIN_PASSWORD must be set (>= 12 chars) when NODE_ENV=production.',
      });
    }

    // Require a real, non-zero 32-byte encryption key in production. The dev
    // default is 32 ZERO bytes, which passes a length-only check — reject it
    // explicitly so a forgotten key can never silently ship to production.
    if (env.NODE_ENV === 'production') {
      let keyBuf: Buffer;
      try {
        keyBuf = Buffer.from(env.SYSTEM_ENCRYPTION_KEY, 'base64');
      } catch {
        keyBuf = Buffer.alloc(0);
      }
      const allZero = keyBuf.length > 0 && keyBuf.every((b) => b === 0);
      if (keyBuf.length !== 32 || allZero) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SYSTEM_ENCRYPTION_KEY'],
          message:
            'SYSTEM_ENCRYPTION_KEY must be a base64-encoded, non-zero 32-byte key when NODE_ENV=production.',
        });
      }
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
