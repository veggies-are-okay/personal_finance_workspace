"""Unit tests for Plaid webhook JWT/JWKS verification (P6.1, DA-11).

A SYNTHETIC ES256 keypair stands in for Plaid's signing key (no network, no real
key). We mint JWTs against the matching JWK served by a fake gateway, then prove:

* a correctly-signed, fresh JWT whose body hash matches -> verifies (no raise);
* a forged signature (wrong key) -> 401;
* an unsigned / missing header -> 401;
* the wrong alg (HS256) -> 401;
* a stale ``iat`` (older than the window) -> 401;
* a body-hash mismatch (tampered body) -> 401;
* the rate limiter blocks past its window.
"""

from __future__ import annotations

import hashlib
import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from app.connections.webhook import (
    MAX_AGE_SECONDS,
    JwksCache,
    RateLimiter,
    verify_webhook,
)
from app.errors import UnauthorizedError

KID = "synthetic-kid-1"
RAW_BODY = b'{"webhook_type":"TRANSACTIONS","webhook_code":"SYNC_UPDATES_AVAILABLE"}'


def _make_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


def _jwk_from_public(public_key: ec.EllipticCurvePublicKey) -> dict[str, str]:
    """Build an ES256 public JWK from an EC public key (what Plaid would return)."""
    numbers = public_key.public_numbers()

    def b64(value: int) -> str:
        import base64

        raw = value.to_bytes(32, "big")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    return {"kty": "EC", "crv": "P-256", "x": b64(numbers.x), "y": b64(numbers.y), "kid": KID}


class FakeGateway:
    """Serves the synthetic JWK for any kid (parity with the SDK gateway shape)."""

    def __init__(self, jwk: dict[str, str]) -> None:
        self._jwk = jwk
        self.calls = 0

    def get_webhook_verification_key(self, key_id: str) -> dict[str, str]:  # noqa: ARG002
        self.calls += 1
        return self._jwk

    # Unused by the verifier but part of the protocol surface.
    def create_link_token(self, *a, **k):  # pragma: no cover
        raise NotImplementedError

    def exchange_public_token(self, *a, **k):  # pragma: no cover
        raise NotImplementedError

    def create_sandbox_public_token(self, *a, **k):  # pragma: no cover
        raise NotImplementedError


def _sign(private_key: ec.EllipticCurvePrivateKey, claims: dict[str, object]) -> str:
    return jwt.encode(claims, private_key, algorithm="ES256", headers={"kid": KID})


@pytest.fixture
def signing_setup() -> tuple[JwksCache, ec.EllipticCurvePrivateKey, FakeGateway]:
    private_key = _make_key()
    jwk = _jwk_from_public(private_key.public_key())
    gateway = FakeGateway(jwk)
    return JwksCache(gateway), private_key, gateway


def _claims(body: bytes, *, iat: float | None = None) -> dict[str, object]:
    return {
        "iat": int(iat if iat is not None else time.time()),
        "request_body_sha256": hashlib.sha256(body).hexdigest(),
    }


def test_valid_webhook_verifies(signing_setup) -> None:
    jwks, key, gateway = signing_setup
    token = _sign(key, _claims(RAW_BODY))
    # Should not raise.
    verify_webhook(RAW_BODY, token, jwks)
    assert gateway.calls == 1


def test_jwks_cache_reused(signing_setup) -> None:
    jwks, key, gateway = signing_setup
    for _ in range(3):
        verify_webhook(RAW_BODY, _sign(key, _claims(RAW_BODY)), jwks)
    assert gateway.calls == 1  # fetched once, then cached by kid


def test_missing_header_rejected(signing_setup) -> None:
    jwks, _key, _gw = signing_setup
    with pytest.raises(UnauthorizedError):
        verify_webhook(RAW_BODY, None, jwks)


def test_forged_signature_rejected(signing_setup) -> None:
    jwks, _key, _gw = signing_setup
    # Sign with a DIFFERENT key than the JWK the gateway serves.
    attacker = _make_key()
    token = _sign(attacker, _claims(RAW_BODY))
    with pytest.raises(UnauthorizedError):
        verify_webhook(RAW_BODY, token, jwks)


def test_wrong_alg_rejected(signing_setup) -> None:
    jwks, _key, _gw = signing_setup
    token = jwt.encode(_claims(RAW_BODY), "secret", algorithm="HS256", headers={"kid": KID})
    with pytest.raises(UnauthorizedError):
        verify_webhook(RAW_BODY, token, jwks)


def test_missing_kid_rejected(signing_setup) -> None:
    jwks, key, _gw = signing_setup
    token = jwt.encode(_claims(RAW_BODY), key, algorithm="ES256")  # no kid header
    with pytest.raises(UnauthorizedError):
        verify_webhook(RAW_BODY, token, jwks)


def test_stale_iat_rejected(signing_setup) -> None:
    jwks, key, _gw = signing_setup
    stale = time.time() - MAX_AGE_SECONDS - 10
    token = _sign(key, _claims(RAW_BODY, iat=stale))
    with pytest.raises(UnauthorizedError):
        verify_webhook(RAW_BODY, token, jwks)


def test_body_hash_mismatch_rejected(signing_setup) -> None:
    jwks, key, _gw = signing_setup
    # JWT signs the hash of a DIFFERENT body than the one received.
    token = _sign(key, _claims(b'{"tampered":true}'))
    with pytest.raises(UnauthorizedError):
        verify_webhook(RAW_BODY, token, jwks)


def test_missing_body_hash_claim_rejected(signing_setup) -> None:
    jwks, key, _gw = signing_setup
    token = _sign(key, {"iat": int(time.time())})  # no request_body_sha256
    with pytest.raises(UnauthorizedError):
        verify_webhook(RAW_BODY, token, jwks)


def test_garbage_header_rejected(signing_setup) -> None:
    jwks, _key, _gw = signing_setup
    with pytest.raises(UnauthorizedError):
        verify_webhook(RAW_BODY, "not-a-jwt", jwks)


def test_rate_limiter_blocks_past_window() -> None:
    limiter = RateLimiter(max_events=2, window_seconds=60)
    now = 1000.0
    assert limiter.allow(now) is True
    assert limiter.allow(now) is True
    assert limiter.allow(now) is False  # third within the window blocked
    # After the window slides, allowed again.
    assert limiter.allow(now + 61) is True


def test_decode_unverified_header_helper() -> None:
    """The verifier serializes the JWK to JSON for ECAlgorithm.from_jwk."""
    from app.connections.webhook import _json

    assert json.loads(_json({"a": 1})) == {"a": 1}
