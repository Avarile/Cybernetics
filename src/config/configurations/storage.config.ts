import { registerAs } from '@nestjs/config';
import { validateEnv } from '../env.validation';

/**
 * Namespaced object-storage config (MinIO connection + file policy). Consumed by
 * the file-manage infrastructure module, the MinIO health indicator, and the
 * file-processor feature's policy checks.
 */
export const storageConfig = registerAs('storage', () => {
  const env = validateEnv(process.env);
  const allowedMimeTypes = env.FILE_ALLOWED_MIME.split(',')
    .map((mime) => mime.trim())
    .filter((mime) => mime.length > 0);

  return {
    // MinIO connection
    endpoint: env.MINIO_ENDPOINT,
    port: env.MINIO_PORT,
    useSSL: env.MINIO_USE_SSL,
    accessKey: env.MINIO_ACCESS_KEY,
    secretKey: env.MINIO_SECRET_KEY,
    region: env.MINIO_REGION,
    bucket: env.MINIO_BUCKET,
    presignExpirySeconds: env.MINIO_PRESIGN_EXPIRY,

    // File policy
    maxFileSize: env.FILE_MAX_SIZE,
    allowedMimeTypes, // empty array = allow any MIME type
    pendingTtlSeconds: env.FILE_PENDING_TTL,
  };
});

export type StorageConfig = ReturnType<typeof storageConfig>;
