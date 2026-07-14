import { registerAs } from '@nestjs/config';
import { validateEnv } from '../env.validation';

/**
 * Namespaced config for the system-records module. Currently just the secret
 * encryption key + its version (used by EncryptionService). Kept in env — not
 * the DB — because it protects the DB-stored secrets.
 */
export const systemConfig = registerAs('system', () => {
  const env = validateEnv(process.env);
  return {
    encryptionKey: env.SYSTEM_ENCRYPTION_KEY,
    encryptionKeyVersion: env.SYSTEM_ENCRYPTION_KEY_VERSION,
  };
});

export type SystemConfig = ReturnType<typeof systemConfig>;
