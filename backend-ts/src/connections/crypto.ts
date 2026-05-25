import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM token-at-rest encryption (DA-12) — CROSS-BACKEND INTERCHANGEABLE.
 *
 * Byte-compatible with `backend-python/app/connections/crypto.py`: both backends
 * read/write the SAME `plaid_items.access_token` BYTEA column, so the on-disk
 * layout MUST be identical:
 *
 *   nonce(12 bytes) || ciphertext(N) || tag(16 bytes)
 *
 * A token written by FastAPI decrypts here and vice-versa (proven by a parity
 * test). Node's `aes-256-gcm` exposes the tag via `getAuthTag()`; we append it
 * last so the layout matches Python's `AESGCM.encrypt` (which returns
 * `ciphertext || tag`). The key is the base64-decoded `APP_ENCRYPTION_KEY`
 * (exactly 32 bytes). No plaintext token is ever logged (DA-14).
 */

export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;

export class TokenCipherError extends Error {}

/** Decode + validate the base64 AES-256 key (must be exactly 32 bytes). */
function loadKey(appEncryptionKey: string): Buffer {
  if (!appEncryptionKey) {
    throw new TokenCipherError('APP_ENCRYPTION_KEY is not configured.');
  }
  let key: Buffer;
  try {
    key = Buffer.from(appEncryptionKey, 'base64');
  } catch {
    throw new TokenCipherError('APP_ENCRYPTION_KEY is not valid base64.');
  }
  if (key.length !== 32) {
    throw new TokenCipherError(
      'APP_ENCRYPTION_KEY must decode to 32 bytes (AES-256).',
    );
  }
  return key;
}

/** Encrypt `plaintext` -> `nonce(12) || ciphertext || tag(16)` bytes. */
export function encryptToken(
  plaintext: string,
  appEncryptionKey: string,
): Buffer {
  const key = loadKey(appEncryptionKey);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag(); // 16 bytes
  return Buffer.concat([nonce, ciphertext, tag]);
}

/** Decrypt a `nonce(12) || ciphertext || tag(16)` blob back to the token. */
export function decryptToken(blob: Buffer, appEncryptionKey: string): string {
  const key = loadKey(appEncryptionKey);
  if (blob.length < NONCE_BYTES + TAG_BYTES) {
    throw new TokenCipherError('Ciphertext blob is too short to be valid.');
  }
  const nonce = blob.subarray(0, NONCE_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ciphertext = blob.subarray(NONCE_BYTES, blob.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Never leak why (bad tag / wrong key / corrupt blob).
    throw new TokenCipherError('Token decryption failed.');
  }
}
