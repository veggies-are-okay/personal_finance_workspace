"""Endpoint + service tests for the connections API (P6.1).

Exercises the real FastAPI route wiring with a fake Plaid gateway (CI hermetic —
no network) and a transactional Postgres session (synthetic data, rolled back).
Covers: link-token success + Plaid-down 503; exchange encrypts + stores (NO
plaintext at rest) and returns the right shape; list snapshot; webhook 401 on a
forged/unsigned request and 200 on a verified one; OAuth allowlist accept/reject;
redaction.
"""

from __future__ import annotations

import base64
import hashlib
import time
from collections.abc import Iterator
from datetime import datetime, timezone

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.connections import router as router_mod
from app.connections.crypto import decrypt_token
from app.connections.plaid_gateway import ExchangeResult, LinkToken
from app.connections.service import (
    list_connections,
    resolve_redirect,
    sources_for_products,
    store_exchanged_item,
)
from app.connections.webhook import JwksCache
from app.db import SessionLocal, get_db
from app.main import app
from app.models import PlaidItem

KEY_B64 = base64.b64encode(b"0123456789abcdef0123456789abcdef").decode()
KID = "synthetic-kid-1"
SYNTHETIC_ACCESS_TOKEN = "access-sandbox-synthetic-do-not-store-plaintext"
SYNTHETIC_ITEM_ID = "item-parity-p61-001"


@pytest.fixture
def db_session() -> Iterator[Session]:
    connection = SessionLocal().connection()
    transaction = connection.begin_nested() if connection.in_transaction() else connection.begin()
    session = Session(bind=connection)
    try:
        yield session
    finally:
        session.close()
        if transaction.is_active:
            transaction.rollback()
        connection.close()


def _settings() -> Settings:
    return Settings(app_encryption_key=KEY_B64, plaid_user_id="local")


class FakeGateway:
    def __init__(self) -> None:
        self.link_calls = 0
        self.exchange_calls = 0
        self.raise_on_link = False
        self.raise_on_exchange = False

    def create_link_token(self, products, *, webhook, user_id):  # noqa: ARG002
        self.link_calls += 1
        if self.raise_on_link:
            raise RuntimeError("plaid down")
        return LinkToken(
            link_token="link-sandbox-synthetic",
            expiration=datetime(2026, 5, 24, 10, 30, tzinfo=timezone.utc),
        )

    def exchange_public_token(self, public_token):  # noqa: ARG002
        self.exchange_calls += 1
        if self.raise_on_exchange:
            raise RuntimeError("plaid down")
        return ExchangeResult(access_token=SYNTHETIC_ACCESS_TOKEN, item_id=SYNTHETIC_ITEM_ID)

    def get_webhook_verification_key(self, key_id):  # noqa: ARG002
        return _jwk()

    def create_sandbox_public_token(self, institution_id, initial_products):  # noqa: ARG002
        return "public-sandbox-synthetic"


# --- shared EC signing material for the webhook endpoint test ---------------
_PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())


def _jwk() -> dict[str, str]:
    numbers = _PRIVATE_KEY.public_key().public_numbers()

    def b64(value: int) -> str:
        return base64.urlsafe_b64encode(value.to_bytes(32, "big")).rstrip(b"=").decode()

    return {"kty": "EC", "crv": "P-256", "x": b64(numbers.x), "y": b64(numbers.y), "kid": KID}


@pytest.fixture
def client(db_session: Session) -> Iterator[TestClient]:
    gateway = FakeGateway()
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_settings] = _settings
    app.dependency_overrides[router_mod.get_gateway] = lambda: gateway
    app.dependency_overrides[router_mod.get_jwks_cache] = lambda: JwksCache(gateway)
    with TestClient(app) as c:
        c.gateway = gateway  # type: ignore[attr-defined]
        yield c
    app.dependency_overrides.clear()


# --- link-token -------------------------------------------------------------


def test_link_token_success(client: TestClient) -> None:
    r = client.post("/api/v1/connections/link-token", json={"products": ["transactions"]})
    assert r.status_code == 200
    body = r.json()
    assert body["link_token"] == "link-sandbox-synthetic"
    assert body["expiration"] == "2026-05-24T10:30:00Z"  # ISO-Z


def test_link_token_empty_body_uses_defaults(client: TestClient) -> None:
    r = client.post("/api/v1/connections/link-token")
    assert r.status_code == 200


def test_link_token_plaid_down_503(client: TestClient) -> None:
    client.gateway.raise_on_link = True  # type: ignore[attr-defined]
    r = client.post("/api/v1/connections/link-token", json={})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "SERVICE_UNAVAILABLE"


# --- exchange (encryption + no plaintext at rest) ---------------------------


def test_exchange_encrypts_and_stores_no_plaintext(client: TestClient, db_session: Session) -> None:
    r = client.post(
        "/api/v1/connections/exchange", json={"public_token": "public-sandbox-synthetic"}
    )
    assert r.status_code == 200
    assert r.json() == {"item_id": SYNTHETIC_ITEM_ID, "status": "connected"}

    # The stored access_token is ciphertext, NOT the plaintext token (DA-12).
    item = db_session.scalar(select(PlaidItem).where(PlaidItem.item_id == SYNTHETIC_ITEM_ID))
    assert item is not None
    stored = bytes(item.access_token)
    assert SYNTHETIC_ACCESS_TOKEN.encode() not in stored
    # ...and it decrypts back to the original with the configured key.
    assert decrypt_token(stored, KEY_B64) == SYNTHETIC_ACCESS_TOKEN


def test_exchange_missing_field_422(client: TestClient) -> None:
    r = client.post("/api/v1/connections/exchange", json={})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_exchange_plaid_down_503(client: TestClient) -> None:
    client.gateway.raise_on_exchange = True  # type: ignore[attr-defined]
    r = client.post("/api/v1/connections/exchange", json={"public_token": "x"})
    assert r.status_code == 503


# --- list connections -------------------------------------------------------


def test_list_connections_shape(client: TestClient, db_session: Session) -> None:
    # Seed a connected item feeding transactions+loans.
    store_exchanged_item(
        db_session,
        item_id=SYNTHETIC_ITEM_ID,
        access_token=SYNTHETIC_ACCESS_TOKEN,
        user_id="local",
        app_encryption_key=KEY_B64,
        institution="Example Bank",
        products=["transactions", "liabilities"],
    )
    r = client.get("/api/v1/connections")
    assert r.status_code == 200
    body = r.json()
    assert sorted(body.keys()) == ["items", "sources"]
    # Five canonical sources always present.
    assert {s["source"] for s in body["sources"]} == {
        "transactions",
        "income",
        "holdings",
        "loans",
        "listings",
    }
    tx = next(s for s in body["sources"] if s["source"] == "transactions")
    assert tx["status"] == "connected"
    assert tx["mode"] in ("local", "api")
    item = next(i for i in body["items"] if i["item_id"] == SYNTHETIC_ITEM_ID)
    assert item["institution"] == "Example Bank"
    assert sorted(item["sources"]) == ["loans", "transactions"]


# --- webhook ----------------------------------------------------------------


def _signed(body: bytes, *, iat: float | None = None) -> str:
    claims = {
        "iat": int(iat if iat is not None else time.time()),
        "request_body_sha256": hashlib.sha256(body).hexdigest(),
    }
    return jwt.encode(claims, _PRIVATE_KEY, algorithm="ES256", headers={"kid": KID})


def test_webhook_verified_200(client: TestClient) -> None:
    body = b'{"webhook_type":"TRANSACTIONS","webhook_code":"SYNC_UPDATES_AVAILABLE"}'
    r = client.post(
        "/api/v1/connections/webhook",
        content=body,
        headers={"plaid-verification": _signed(body), "content-type": "application/json"},
    )
    assert r.status_code == 200
    assert r.json() == {"status": "accepted"}


def test_webhook_unsigned_401(client: TestClient) -> None:
    body = b'{"webhook_type":"TRANSACTIONS","webhook_code":"X"}'
    r = client.post(
        "/api/v1/connections/webhook", content=body, headers={"content-type": "application/json"}
    )
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "UNAUTHORIZED"


def test_webhook_forged_401(client: TestClient) -> None:
    body = b'{"webhook_type":"TRANSACTIONS","webhook_code":"X"}'
    attacker = ec.generate_private_key(ec.SECP256R1())
    forged = jwt.encode(
        {"iat": int(time.time()), "request_body_sha256": hashlib.sha256(body).hexdigest()},
        attacker,
        algorithm="ES256",
        headers={"kid": KID},
    )
    r = client.post(
        "/api/v1/connections/webhook",
        content=body,
        headers={"plaid-verification": forged, "content-type": "application/json"},
    )
    assert r.status_code == 401


def test_webhook_verified_but_bad_body_schema_422(client: TestClient) -> None:
    body = b'{"unexpected":"shape"}'  # passes JWT (hash matches) but fails schema
    r = client.post(
        "/api/v1/connections/webhook",
        content=body,
        headers={"plaid-verification": _signed(body), "content-type": "application/json"},
    )
    assert r.status_code == 422


# --- OAuth redirect allowlist ----------------------------------------------


def test_oauth_redirect_allowlisted(client: TestClient) -> None:
    r = client.get(
        "/api/v1/connections/oauth",
        params={"redirect_uri": "http://localhost:5173/oauth"},
        follow_redirects=False,
    )
    assert r.status_code == 307
    assert r.headers["location"] == "http://localhost:5173/oauth"


def test_oauth_redirect_rejects_non_allowlisted(client: TestClient) -> None:
    r = client.get(
        "/api/v1/connections/oauth",
        params={"redirect_uri": "http://evil.example.com/steal"},
        follow_redirects=False,
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


# --- service-layer units ----------------------------------------------------


def test_sources_for_products_mapping() -> None:
    assert sources_for_products(["transactions", "liabilities"]) == ["loans", "transactions"]
    assert sources_for_products(["investments"]) == ["holdings"]
    assert sources_for_products(None) == []
    assert sources_for_products(["unknown"]) == []


def test_resolve_redirect_exact_match_only() -> None:
    allow = ["http://localhost:5173/oauth"]
    assert resolve_redirect("http://localhost:5173/oauth", allow) == "http://localhost:5173/oauth"
    with pytest.raises(ValueError):
        resolve_redirect("http://localhost:5173/oauth/../evil", allow)
    with pytest.raises(ValueError):
        resolve_redirect("http://localhost:5173/oauthX", allow)


def test_store_exchanged_item_upsert(db_session: Session) -> None:
    s1 = store_exchanged_item(
        db_session,
        item_id="item-upsert",
        access_token="tok-1",
        user_id="local",
        app_encryption_key=KEY_B64,
        products=["transactions"],
    )
    assert s1 == "connected"
    # Re-link updates in place (idempotent) — one row.
    store_exchanged_item(
        db_session,
        item_id="item-upsert",
        access_token="tok-2",
        user_id="local",
        app_encryption_key=KEY_B64,
        products=["transactions"],
    )
    count = db_session.scalar(
        text("SELECT count(*) FROM plaid_items WHERE item_id = 'item-upsert'")
    )
    assert count == 1
    item = db_session.scalar(select(PlaidItem).where(PlaidItem.item_id == "item-upsert"))
    assert decrypt_token(bytes(item.access_token), KEY_B64) == "tok-2"


def test_list_connections_empty_db(db_session: Session) -> None:
    snapshot = list_connections(db_session)
    assert snapshot.items == []
    assert len(snapshot.sources) == 5
    assert all(s.status == "not_connected" for s in snapshot.sources)
