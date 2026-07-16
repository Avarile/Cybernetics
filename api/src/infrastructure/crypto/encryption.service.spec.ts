import { EncryptionService } from './encryption.service';

/** ConfigService stub returning a fixed 32-byte key. */
function makeService(
  keyB64 = Buffer.alloc(32, 7).toString('base64'),
  version = 1,
) {
  const config = {
    getOrThrow: () => ({
      encryptionKey: keyB64,
      encryptionKeyVersion: version,
    }),
  } as any;
  return new EncryptionService(config);
}

describe('EncryptionService', () => {
  it('round-trips a plaintext through encrypt/decrypt', () => {
    const svc = makeService();
    const secret = 'sup3r-secret-smtp-password';
    const envelope = svc.encrypt(secret);
    expect(envelope).not.toContain(secret);
    expect(envelope.startsWith('v1.')).toBe(true);
    expect(svc.decrypt(envelope)).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const svc = makeService();
    expect(svc.encrypt('same')).not.toBe(svc.encrypt('same'));
  });

  it('throws when the ciphertext is tampered with', () => {
    const svc = makeService();
    const env = svc.encrypt('secret');
    const parts = env.split('.');
    const ct = Buffer.from(parts[3], 'base64');
    ct[0] ^= 0xff; // flip a bit
    parts[3] = ct.toString('base64');
    expect(() => svc.decrypt(parts.join('.'))).toThrow();
  });

  it('rejects a malformed envelope', () => {
    const svc = makeService();
    expect(() => svc.decrypt('not-an-envelope')).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => makeService(Buffer.alloc(16).toString('base64'))).toThrow();
  });
});
