import { randomUUID } from 'node:crypto';

/** Content-addressed object key: `sha256/ab/cd/<full-hash>` (sharded prefix). */
export function contentAddressedKey(sha256: string): string {
  const hash = sha256.toLowerCase();
  return `sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
}

/** Random object key for uploads whose checksum is not known up front. */
export function randomObjectKey(): string {
  return `uploads/${randomUUID()}`;
}

/** True when the MIME type is permitted (empty allowlist = allow any). */
export function isMimeAllowed(
  mimeType: string,
  allowlist: readonly string[],
): boolean {
  return allowlist.length === 0 || allowlist.includes(mimeType);
}

/**
 * Minimal magic-byte MIME sniffer for common types. Returns the detected MIME
 * type, or `null` when the signature is unrecognised (unknown ≠ mismatch). Swap
 * for the `file-type` package to broaden coverage.
 */
export function detectMimeFromMagic(head: Buffer): string | null {
  if (head.length >= 4) {
    // %PDF
    if (
      head[0] === 0x25 &&
      head[1] === 0x50 &&
      head[2] === 0x44 &&
      head[3] === 0x46
    ) {
      return 'application/pdf';
    }
    // PNG: 89 50 4E 47
    if (
      head[0] === 0x89 &&
      head[1] === 0x50 &&
      head[2] === 0x4e &&
      head[3] === 0x47
    ) {
      return 'image/png';
    }
    // GIF8
    if (
      head[0] === 0x47 &&
      head[1] === 0x49 &&
      head[2] === 0x46 &&
      head[3] === 0x38
    ) {
      return 'image/gif';
    }
    // ZIP / OOXML / JAR / …: PK 03 04
    if (
      head[0] === 0x50 &&
      head[1] === 0x4b &&
      head[2] === 0x03 &&
      head[3] === 0x04
    ) {
      return 'application/zip';
    }
  }
  if (head.length >= 3) {
    // JPEG: FF D8 FF
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
      return 'image/jpeg';
    }
  }
  return null;
}

/** Zip-based container formats that legitimately present a ZIP signature. */
function isZipFamily(mime: string): boolean {
  return (
    mime === 'application/zip' ||
    mime.startsWith('application/vnd.openxmlformats-officedocument') ||
    mime.startsWith('application/vnd.oasis.opendocument') ||
    mime === 'application/epub+zip' ||
    mime === 'application/java-archive'
  );
}

/**
 * Conclusive only for signatures we recognise: returns `true` only when we
 * positively detect a type that contradicts the declared MIME type.
 */
export function isDeclaredMimeMismatch(
  declared: string,
  head: Buffer,
): boolean {
  const detected = detectMimeFromMagic(head);
  if (detected === null) return false; // unknown signature — not a mismatch
  if (detected === declared) return false;
  if (detected === 'application/zip' && isZipFamily(declared)) return false;
  return true;
}
