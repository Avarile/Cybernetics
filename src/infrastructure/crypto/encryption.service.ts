import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SystemConfig } from '../../config/configurations/system.config';

/**
 * Reversible secret encryption at rest (AES-256-GCM). The counterpart to the
 * one-way TokenService.hashToken: values encrypted here (SMTP/IMAP passwords,
 * integration tokens) must be decryptable to be used.
 *
 * Envelope (single self-describing string): `v{version}.{iv}.{tag}.{ciphertext}`
 * with each binary part base64-encoded. The version prefix leaves room for key
 * rotation without a schema change (v1 ships a single key).
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;
  private readonly version: number;

  constructor(config: ConfigService) {
    const cfg = config.getOrThrow<SystemConfig>('system');
    this.key = Buffer.from(cfg.encryptionKey, 'base64');
    if (this.key.length !== 32) {
      throw new Error(
        'SYSTEM_ENCRYPTION_KEY must decode to 32 bytes (AES-256).',
      );
    }
    this.version = cfg.encryptionKeyVersion;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      `v${this.version}`,
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join('.');
  }

  decrypt(envelope: string): string {
    const parts = envelope.split('.');
    if (parts.length !== 4 || !parts[0].startsWith('v')) {
      throw new Error('Malformed encryption envelope.');
    }
    const [, ivB64, tagB64, ctB64] = parts;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
