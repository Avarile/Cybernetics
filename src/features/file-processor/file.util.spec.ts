import {
  contentAddressedKey,
  detectMimeFromMagic,
  isDeclaredMimeMismatch,
  isMimeAllowed,
  randomObjectKey,
} from './file.util';

describe('file.util', () => {
  describe('contentAddressedKey', () => {
    it('shards by the first two byte-pairs and lowercases', () => {
      const hash = 'AB'.repeat(32); // 64 hex chars
      expect(contentAddressedKey(hash)).toBe(`sha256/ab/ab/${'ab'.repeat(32)}`);
    });
  });

  describe('randomObjectKey', () => {
    it('is unique and prefixed with uploads/', () => {
      const a = randomObjectKey();
      const b = randomObjectKey();
      expect(a).toMatch(/^uploads\/[0-9a-f-]{36}$/);
      expect(a).not.toBe(b);
    });
  });

  describe('isMimeAllowed', () => {
    it('allows any type when the allowlist is empty', () => {
      expect(isMimeAllowed('application/x-anything', [])).toBe(true);
    });
    it('enforces the allowlist when set', () => {
      expect(isMimeAllowed('image/png', ['image/png'])).toBe(true);
      expect(isMimeAllowed('image/gif', ['image/png'])).toBe(false);
    });
  });

  describe('detectMimeFromMagic', () => {
    it('detects PNG', () => {
      expect(detectMimeFromMagic(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(
        'image/png',
      );
    });
    it('detects PDF', () => {
      expect(detectMimeFromMagic(Buffer.from('%PDF-1.7'))).toBe(
        'application/pdf',
      );
    });
    it('detects JPEG', () => {
      expect(detectMimeFromMagic(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
        'image/jpeg',
      );
    });
    it('returns null for unknown signatures', () => {
      expect(
        detectMimeFromMagic(Buffer.from([0x00, 0x01, 0x02, 0x03])),
      ).toBeNull();
    });
  });

  describe('isDeclaredMimeMismatch', () => {
    it('flags a declared png that is actually a pdf', () => {
      expect(isDeclaredMimeMismatch('image/png', Buffer.from('%PDF-1.7'))).toBe(
        true,
      );
    });
    it('accepts a matching declaration', () => {
      expect(
        isDeclaredMimeMismatch(
          'image/png',
          Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        ),
      ).toBe(false);
    });
    it('does not flag unknown signatures', () => {
      expect(
        isDeclaredMimeMismatch(
          'image/png',
          Buffer.from([0x00, 0x01, 0x02, 0x03]),
        ),
      ).toBe(false);
    });
    it('treats OOXML (docx) as compatible with a zip signature', () => {
      const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      expect(
        isDeclaredMimeMismatch(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          zip,
        ),
      ).toBe(false);
    });
  });
});
