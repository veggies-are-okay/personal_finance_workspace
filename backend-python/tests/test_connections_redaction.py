"""Redaction tests (P6.1, DA-14): no token/secret ever reaches a log path."""

from __future__ import annotations

import logging

from app.connections.redaction import REDACTED, redact, safe_log


def test_redact_scrubs_secret_keys_recursively() -> None:
    payload = {
        "access_token": "access-sandbox-secret",
        "public_token": "public-sandbox-secret",
        "link_token": "link-sandbox-secret",
        "nested": {"secret": "shh", "item_id": "item-1"},
        "list": [{"authorization": "Bearer x"}],
        "item_id": "item-1",
    }
    out = redact(payload)
    assert out["access_token"] == REDACTED
    assert out["public_token"] == REDACTED
    assert out["link_token"] == REDACTED
    assert out["nested"]["secret"] == REDACTED
    assert out["list"][0]["authorization"] == REDACTED
    # Non-secret keys pass through unchanged.
    assert out["item_id"] == "item-1"
    assert out["nested"]["item_id"] == "item-1"


def test_redact_passthrough_scalars() -> None:
    assert redact("plain") == "plain"
    assert redact(7) == 7


def test_safe_log_never_emits_token(caplog) -> None:
    secret = "access-sandbox-MUST-NOT-APPEAR"
    with caplog.at_level(logging.INFO, logger="app.connections"):
        safe_log("item_linked", access_token=secret, item_id="item-1", status="connected")
    combined = "\n".join(r.getMessage() for r in caplog.records)
    assert secret not in combined
    assert REDACTED in combined
    assert "item-1" in combined  # non-secret context still logged
