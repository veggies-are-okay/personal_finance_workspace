"""Plaid webhook JWT/JWKS verification (DA-11) + a tiny rate limiter.

Plaid signs each webhook with an ES256 JWT carried in the ``Plaid-Verification``
header. Verification (current public flow, confirmed via research):

1. Read the RAW request body bytes (before JSON parsing).
2. Decode the JWT header WITHOUT verifying; require ``alg == "ES256"`` and a
   ``kid``. Anything else -> reject.
3. Fetch the JWK for that ``kid`` from Plaid ``/webhook_verification_key/get``
   (cached by kid; injected gateway in tests so CI is hermetic).
4. Verify the JWT SIGNATURE with the JWK (ES256).
5. Check ``iat`` freshness — reject if older than ``MAX_AGE_SECONDS`` (5 min).
6. Compute SHA-256 of the raw body and constant-time compare it to the JWT's
   ``request_body_sha256`` claim. Mismatch -> reject (body was tampered).

Any failure raises :class:`~app.errors.UnauthorizedError` -> canonical 401. The
verifier NEVER logs the body, the JWT, or the token (DA-14).
"""

from __future__ import annotations

import hashlib
import hmac
import time
from collections import deque
from threading import Lock
from typing import Any

import jwt
from jwt.algorithms import ECAlgorithm

from app.connections.plaid_gateway import PlaidGateway
from app.errors import UnauthorizedError

ALGORITHM = "ES256"
MAX_AGE_SECONDS = 300  # 5-minute freshness window (replay protection).


class JwksCache:
    """Caches Plaid JWKs by ``kid`` (fetched via the injected gateway)."""

    def __init__(self, gateway: PlaidGateway) -> None:
        self._gateway = gateway
        self._cache: dict[str, dict[str, Any]] = {}
        self._lock = Lock()

    def get_key(self, kid: str) -> dict[str, Any]:
        with self._lock:
            cached = self._cache.get(kid)
        if cached is not None:
            return cached
        key = self._gateway.get_webhook_verification_key(kid)
        with self._lock:
            self._cache[kid] = key
        return key


class RateLimiter:
    """Fixed-window in-memory rate limiter (per-process; single-user app)."""

    def __init__(self, max_events: int = 60, window_seconds: int = 60) -> None:
        self._max = max_events
        self._window = window_seconds
        self._events: deque[float] = deque()
        self._lock = Lock()

    def allow(self, now: float | None = None) -> bool:
        now = time.time() if now is None else now
        with self._lock:
            cutoff = now - self._window
            while self._events and self._events[0] < cutoff:
                self._events.popleft()
            if len(self._events) >= self._max:
                return False
            self._events.append(now)
            return True


def verify_webhook(
    raw_body: bytes,
    verification_header: str | None,
    jwks: JwksCache,
    *,
    now: float | None = None,
) -> None:
    """Verify a Plaid webhook; raise :class:`UnauthorizedError` on ANY failure."""
    if not verification_header:
        raise UnauthorizedError()

    now = time.time() if now is None else now

    # 1) Decode the JWT header unverified to pull alg + kid.
    try:
        header = jwt.get_unverified_header(verification_header)
    except jwt.PyJWTError as exc:
        raise UnauthorizedError() from exc

    if header.get("alg") != ALGORITHM:
        raise UnauthorizedError()
    kid = header.get("kid")
    if not kid:
        raise UnauthorizedError()

    # 2) Fetch the JWK and build the EC public key.
    try:
        jwk = jwks.get_key(kid)
        public_key = ECAlgorithm.from_jwk(_json(jwk))
    except Exception as exc:  # unknown kid / malformed jwk
        raise UnauthorizedError() from exc

    # 3) Verify the signature + iat freshness. Disable jwt's own exp/aud checks;
    #    we enforce iat ourselves to match the documented Plaid flow exactly.
    try:
        claims = jwt.decode(
            verification_header,
            key=public_key,
            algorithms=[ALGORITHM],
            options={"verify_aud": False, "verify_exp": False, "require": ["iat"]},
        )
    except jwt.PyJWTError as exc:
        raise UnauthorizedError() from exc

    iat = claims.get("iat")
    if not isinstance(iat, (int, float)) or now - float(iat) > MAX_AGE_SECONDS:
        raise UnauthorizedError()

    # 4) Body integrity: SHA-256(raw body) == request_body_sha256 (constant-time).
    expected = claims.get("request_body_sha256")
    if not isinstance(expected, str):
        raise UnauthorizedError()
    actual = hashlib.sha256(raw_body).hexdigest()
    if not hmac.compare_digest(actual, expected):
        raise UnauthorizedError()


def _json(obj: dict[str, Any]) -> str:
    """Serialize a JWK dict to JSON for ``ECAlgorithm.from_jwk`` (which takes str)."""
    import json

    return json.dumps(obj)
