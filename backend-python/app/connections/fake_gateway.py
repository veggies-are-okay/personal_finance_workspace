"""A deterministic, network-free Plaid gateway for hermetic parity/CI runs.

Activated by ``PLAID_FAKE=1`` (set by the ``contracts/`` parity harness and CI).
It returns canned link/exchange data and serves a FIXED synthetic ES256 JWK
(``FAKE_JWK``) — the SAME key both backends serve, so a webhook signed with the
matching synthetic private key verifies identically in FastAPI and NestJS.

The key here is a SYNTHETIC test key, never a real Plaid key. It mirrors
``backend-ts/src/connections/fake-gateway.ts`` byte-for-byte so the cross-backend
webhook-verification parity test passes against either backend.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.connections.plaid_gateway import ExchangeResult, LinkToken

# A FIXED synthetic ES256 public JWK (kid = pf-fake-kid-1). Shared verbatim with
# backend-ts so a JWT signed by the matching synthetic private key verifies in
# BOTH backends. SYNTHETIC test material only.
FAKE_JWK: dict[str, str] = {
    "kty": "EC",
    "crv": "P-256",
    "x": "zcWqQdsXEO_rEU-1SRUz7G2xlgHOOKEPrLdNObL94bc",
    "y": "F838KToH8Cn-eVqGP6_NDCTSuPeMa8S9I7X6IdxjvT4",
    "kid": "pf-fake-kid-1",
    "alg": "ES256",
    "use": "sig",
}

FAKE_LINK_TOKEN = "link-sandbox-fake-0000"
FAKE_ITEM_ID = "item-fake-0001"
# A SYNTHETIC access token. The test asserts this string never appears in the
# BYTEA column (it is only ever stored encrypted).
FAKE_ACCESS_TOKEN = "access-fake-do-not-store-plaintext"
FAKE_EXPIRATION = datetime(2026, 5, 24, 10, 30, tzinfo=timezone.utc)


class FakePlaidGateway:
    """Network-free gateway returning canned data + the fixed synthetic JWK."""

    def create_link_token(self, products: list[str], *, webhook: str, user_id: str) -> LinkToken:  # noqa: ARG002
        return LinkToken(link_token=FAKE_LINK_TOKEN, expiration=FAKE_EXPIRATION)

    def exchange_public_token(self, public_token: str) -> ExchangeResult:  # noqa: ARG002
        return ExchangeResult(access_token=FAKE_ACCESS_TOKEN, item_id=FAKE_ITEM_ID)

    def get_webhook_verification_key(self, key_id: str) -> dict[str, Any]:  # noqa: ARG002
        return dict(FAKE_JWK)

    def create_sandbox_public_token(self, institution_id: str, initial_products: list[str]) -> str:  # noqa: ARG002
        return "public-sandbox-fake-0000"
