import {
  NONCE_BYTES,
  TAG_BYTES,
  TokenCipherError,
  decryptToken,
  encryptToken,
} from './crypto';

/**
 * Token-at-rest encryption (P6.1, DA-12). Proves the AES-256-GCM round-trip, the
 * fixed layout (nonce(12)||ciphertext||tag(16)), no plaintext at rest, a fresh
 * nonce per write, tamper detection, and key validation. The "token" is a
 * SYNTHETIC string — never a real Plaid token.
 */

// Synthetic 32-byte AES-256 key, base64 (NOT a real APP_ENCRYPTION_KEY).
const KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const SYNTHETIC_TOKEN = 'access-sandbox-synthetic-token-value-XYZ';

describe('token crypto (AES-256-GCM)', () => {
  it('round-trips plaintext', () => {
    const blob = encryptToken(SYNTHETIC_TOKEN, KEY);
    expect(decryptToken(blob, KEY)).toBe(SYNTHETIC_TOKEN);
  });

  it('uses the nonce||ciphertext||tag layout and stores no plaintext', () => {
    const blob = encryptToken(SYNTHETIC_TOKEN, KEY);
    expect(blob.length).toBeGreaterThanOrEqual(NONCE_BYTES + TAG_BYTES + 1);
    expect(blob.includes(Buffer.from(SYNTHETIC_TOKEN))).toBe(false);
  });

  it('uses a fresh random nonce each write', () => {
    const a = encryptToken(SYNTHETIC_TOKEN, KEY);
    const b = encryptToken(SYNTHETIC_TOKEN, KEY);
    expect(a.equals(b)).toBe(false);
    expect(a.subarray(0, NONCE_BYTES).equals(b.subarray(0, NONCE_BYTES))).toBe(
      false,
    );
  });

  it('rejects a tampered blob (bad auth tag)', () => {
    const blob = Buffer.from(encryptToken(SYNTHETIC_TOKEN, KEY));
    blob[blob.length - 1] ^= 0x01;
    expect(() => decryptToken(blob, KEY)).toThrow(TokenCipherError);
  });

  it.each([
    ['', 'empty key'],
    [Buffer.from('too-short').toString('base64'), 'short key'],
  ])('rejects an invalid key (%s)', (badKey) => {
    expect(() => encryptToken(SYNTHETIC_TOKEN, badKey)).toThrow(
      TokenCipherError,
    );
  });

  it('rejects a too-short blob', () => {
    expect(() => decryptToken(Buffer.from('short'), KEY)).toThrow(
      TokenCipherError,
    );
  });
});
