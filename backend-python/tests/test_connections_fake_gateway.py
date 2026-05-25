"""Unit coverage for the network-free fake Plaid gateway (P6.1).

The fake gateway is what the ``contracts/`` parity harness + CI use
(``PLAID_FAKE=1``) so no real Plaid call is made. These tests pin its canned
returns and the ``PLAID_FAKE`` selection branch in the router's gateway factory.
"""

from __future__ import annotations

from app.connections.fake_gateway import (
    FAKE_ACCESS_TOKEN,
    FAKE_ITEM_ID,
    FAKE_JWK,
    FakePlaidGateway,
)


def test_fake_gateway_canned_returns() -> None:
    gw = FakePlaidGateway()
    link = gw.create_link_token(["transactions"], webhook="http://x", user_id="local")
    assert link.link_token.startswith("link-sandbox-fake")
    exchange = gw.exchange_public_token("public-fake")
    assert exchange.item_id == FAKE_ITEM_ID
    assert exchange.access_token == FAKE_ACCESS_TOKEN
    assert gw.get_webhook_verification_key("pf-fake-kid-1") == FAKE_JWK
    assert gw.create_sandbox_public_token("ins_109508", ["transactions"]).startswith(
        "public-sandbox-fake"
    )


def test_router_selects_fake_gateway_when_plaid_fake(monkeypatch) -> None:
    monkeypatch.setenv("PLAID_FAKE", "1")
    from app.connections import router as router_mod

    router_mod._default_gateway.cache_clear()
    try:
        gw = router_mod.get_gateway()
        assert isinstance(gw, FakePlaidGateway)
    finally:
        router_mod._default_gateway.cache_clear()
