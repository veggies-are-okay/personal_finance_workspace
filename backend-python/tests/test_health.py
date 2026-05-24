"""Tests for the canonical ``GET /health`` contract.

Contract (P1.3 NestJS must mirror exactly):
    GET /health -> 200, body == {"status": "ok"}, content-type application/json.
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_health_returns_200_and_ok_body(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_health_content_type_is_json(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.headers["content-type"].startswith("application/json")


def test_health_is_in_openapi_schema(client: TestClient) -> None:
    from app.main import app

    schema = app.openapi()
    assert "/health" in schema["paths"]
    assert "get" in schema["paths"]["/health"]
