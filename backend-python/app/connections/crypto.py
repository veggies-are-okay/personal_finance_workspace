"""AES-256-GCM token-at-rest encryption (DA-12) — CROSS-BACKEND INTERCHANGEABLE.

A Plaid ``access_token`` is secret. It is stored only as ciphertext in
``plaid_items.access_token`` (``BYTEA``), never as plaintext.

The on-disk format is a fixed, backend-neutral byte layout so a token written by
FastAPI decrypts in NestJS and vice-versa (both read/write the SAME row)::

    nonce(12 bytes) || ciphertext(N) || tag(16 bytes)

* Key: the base64-decoded ``APP_ENCRYPTION_KEY`` (exactly 32 bytes = AES-256).
* Nonce: 12 random bytes per write (GCM standard), prepended.
* Tag: GCM's 16-byte authentication tag, appended (this is what Python's
  ``AESGCM`` returns concatenated to the ciphertext, and what Node's
  ``aes-256-gcm`` exposes via ``getAuthTag()`` — packing it last makes both
  byte-identical).

No plaintext token is ever logged or returned (DA-14).
"""

from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

NONCE_BYTES = 12
TAG_BYTES = 16


class TokenCipherError(Exception):
    """Raised when the encryption key is missing/invalid or a blob won't decrypt."""


def _load_key(app_encryption_key: str) -> bytes:
    """Decode + validate the base64 AES-256 key (must be exactly 32 bytes)."""
    if not app_encryption_key:
        raise TokenCipherError("APP_ENCRYPTION_KEY is not configured.")
    try:
        key = base64.b64decode(app_encryption_key, validate=True)
    except (ValueError, base64.binascii.Error) as exc:  # type: ignore[attr-defined]
        raise TokenCipherError("APP_ENCRYPTION_KEY is not valid base64.") from exc
    if len(key) != 32:
        raise TokenCipherError("APP_ENCRYPTION_KEY must decode to 32 bytes (AES-256).")
    return key


def encrypt_token(plaintext: str, app_encryption_key: str) -> bytes:
    """Encrypt ``plaintext`` -> ``nonce(12) || ciphertext || tag(16)`` bytes.

    A fresh random nonce is generated per call. ``AESGCM.encrypt`` returns
    ``ciphertext || tag`` already, so we simply prepend the nonce.
    """
    key = _load_key(app_encryption_key)
    nonce = os.urandom(NONCE_BYTES)
    aesgcm = AESGCM(key)
    ciphertext_and_tag = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    return nonce + ciphertext_and_tag


def decrypt_token(blob: bytes, app_encryption_key: str) -> str:
    """Decrypt a ``nonce(12) || ciphertext || tag(16)`` blob back to the token."""
    key = _load_key(app_encryption_key)
    if len(blob) < NONCE_BYTES + TAG_BYTES:
        raise TokenCipherError("Ciphertext blob is too short to be valid.")
    nonce = blob[:NONCE_BYTES]
    ciphertext_and_tag = blob[NONCE_BYTES:]
    aesgcm = AESGCM(key)
    try:
        plaintext = aesgcm.decrypt(nonce, ciphertext_and_tag, None)
    except Exception as exc:  # InvalidTag etc. — never leak detail.
        raise TokenCipherError("Token decryption failed.") from exc
    return plaintext.decode("utf-8")
