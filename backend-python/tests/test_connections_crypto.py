"""Unit tests for token-at-rest encryption (P6.1, DA-12).

Proves the AES-256-GCM round-trip, the fixed on-disk byte layout
(``nonce(12)||ciphertext||tag(16)``), that no plaintext token survives in the
ciphertext, that each write uses a fresh nonce, and that key validation rejects
bad keys. No real Plaid token is used — the "token" here is a synthetic string.
"""

from __future__ import annotations

import base64

import pytest

from app.connections.crypto import (
    NONCE_BYTES,
    TAG_BYTES,
    TokenCipherError,
    decrypt_token,
    encrypt_token,
)

# A synthetic 32-byte AES-256 key, base64-encoded (NOT a real APP_ENCRYPTION_KEY).
KEY = base64.b64encode(b"0123456789abcdef0123456789abcdef").decode()
SYNTHETIC_TOKEN = "access-sandbox-synthetic-token-value-XYZ"


def test_round_trip_recovers_plaintext() -> None:
    blob = encrypt_token(SYNTHETIC_TOKEN, KEY)
    assert decrypt_token(blob, KEY) == SYNTHETIC_TOKEN


def test_layout_and_no_plaintext_at_rest() -> None:
    blob = encrypt_token(SYNTHETIC_TOKEN, KEY)
    # nonce(12) + at-least-one byte of ciphertext + tag(16).
    assert len(blob) >= NONCE_BYTES + TAG_BYTES + 1
    # The plaintext token never appears in the ciphertext bytes.
    assert SYNTHETIC_TOKEN.encode() not in blob


def test_fresh_nonce_each_write() -> None:
    a = encrypt_token(SYNTHETIC_TOKEN, KEY)
    b = encrypt_token(SYNTHETIC_TOKEN, KEY)
    assert a != b  # different random nonce -> different ciphertext
    assert a[:NONCE_BYTES] != b[:NONCE_BYTES]


def test_tamper_detection_rejects_modified_blob() -> None:
    blob = bytearray(encrypt_token(SYNTHETIC_TOKEN, KEY))
    blob[-1] ^= 0x01  # flip a tag byte
    with pytest.raises(TokenCipherError):
        decrypt_token(bytes(blob), KEY)


@pytest.mark.parametrize(
    "bad_key",
    ["", "not-base64!!!", base64.b64encode(b"too-short").decode()],
)
def test_invalid_key_rejected(bad_key: str) -> None:
    with pytest.raises(TokenCipherError):
        encrypt_token(SYNTHETIC_TOKEN, bad_key)


def test_short_blob_rejected() -> None:
    with pytest.raises(TokenCipherError):
        decrypt_token(b"too-short", KEY)
