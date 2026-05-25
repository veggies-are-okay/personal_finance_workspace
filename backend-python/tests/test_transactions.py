"""Tests for ``GET /api/v1/transactions`` (P4.1).

Covers the contract the parity harness also asserts cross-backend:

* success: paginated envelope, money decimal-string, dates ``YYYY-MM-DD``,
  optional ``category``/``bucket`` omitted when absent;
* filters: date range, account, category, free-text ``q``;
* invalid query -> canonical **422** (DA-1);
* offset past end -> empty ``data`` + correct ``total`` (DA-4);
* DB unavailable -> canonical **503** (DA-18).

All data is SYNTHETIC. A disposable Postgres-backed session is built against the
local docker-compose DB (also the CI Postgres service); the ``transactions`` and
``accounts`` rows are seeded per test and rolled back, so the suite never touches
real financial data and leaves no residue.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import insert
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
from app.errors import ServiceUnavailableError
from app.main import app
from app.models import Account, Transaction


@pytest.fixture
def db_session() -> Iterator[Session]:
    """A Postgres session wrapped in a transaction rolled back on teardown.

    Synthetic rows seeded inside a test are discarded afterwards (no residue,
    no real data). Marked slow because it round-trips a real DB.
    """
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


@pytest.fixture
def seeded_session(db_session: Session) -> Session:
    """Seed two accounts + a handful of synthetic transactions."""
    db_session.execute(
        insert(Account),
        [
            {"id": 9001, "name": "Checking", "type": "depository"},
            {"id": 9002, "name": "Credit Card", "type": "credit"},
        ],
    )
    db_session.execute(
        insert(Transaction),
        [
            {
                "account_id": 9001,
                "date": date(2026, 5, 20),
                "description": "Coffee Shop",
                "amount": Decimal("-4.75"),
                "dedupe_key": "tx-seed-1",
                "category": "dining",
                "bucket": "wants",
                "is_recurring": False,
            },
            {
                "account_id": 9001,
                "date": date(2026, 5, 15),
                "description": "Paycheck",
                "amount": Decimal("3100.00"),
                "dedupe_key": "tx-seed-2",
                "category": None,  # uncategorized -> category/bucket omitted on the wire
                "bucket": None,
                "is_recurring": False,
            },
            {
                "account_id": 9002,
                "date": date(2026, 5, 10),
                "description": "Streaming Co",
                "amount": Decimal("-15.99"),
                "dedupe_key": "tx-seed-3",
                "category": "entertainment",
                "bucket": "wants",
                "is_recurring": True,
            },
        ],
    )
    db_session.flush()
    return db_session


@pytest.fixture
def client(seeded_session: Session) -> Iterator[TestClient]:
    """TestClient with ``get_db`` overridden to the seeded transactional session."""
    app.dependency_overrides[get_db] = lambda: seeded_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.mark.slow
class TestTransactionsSuccess:
    def test_returns_paginated_envelope(self, client: TestClient) -> None:
        resp = client.get("/api/v1/transactions")
        assert resp.status_code == 200
        body = resp.json()
        assert set(body.keys()) == {"data", "pagination"}
        assert body["pagination"] == {"limit": 50, "offset": 0, "total": 3}
        assert len(body["data"]) == 3

    def test_default_ordering_is_date_desc(self, client: TestClient) -> None:
        body = client.get("/api/v1/transactions").json()
        dates = [row["date"] for row in body["data"]]
        assert dates == ["2026-05-20", "2026-05-15", "2026-05-10"]

    def test_money_is_decimal_string(self, client: TestClient) -> None:
        body = client.get("/api/v1/transactions").json()
        amounts = {row["description"]: row["amount"] for row in body["data"]}
        assert amounts["Coffee Shop"] == "-4.75"
        assert amounts["Paycheck"] == "3100.00"
        assert amounts["Streaming Co"] == "-15.99"
        # Never a JSON number.
        assert all(isinstance(row["amount"], str) for row in body["data"])

    def test_dates_are_iso_yyyy_mm_dd(self, client: TestClient) -> None:
        body = client.get("/api/v1/transactions").json()
        assert all(len(row["date"]) == 10 and row["date"][4] == "-" for row in body["data"])

    def test_optional_fields_omitted_when_absent(self, client: TestClient) -> None:
        body = client.get("/api/v1/transactions").json()
        paycheck = next(r for r in body["data"] if r["description"] == "Paycheck")
        # Uncategorized -> category/bucket OMITTED (not null) per DA-6.
        assert "category" not in paycheck
        assert "bucket" not in paycheck
        coffee = next(r for r in body["data"] if r["description"] == "Coffee Shop")
        assert coffee["category"] == "dining"
        assert coffee["bucket"] == "wants"
        assert coffee["is_recurring"] is False

    def test_account_name_resolved(self, client: TestClient) -> None:
        body = client.get("/api/v1/transactions").json()
        accounts = {row["description"]: row["account"] for row in body["data"]}
        assert accounts["Coffee Shop"] == "Checking"
        assert accounts["Streaming Co"] == "Credit Card"


@pytest.mark.slow
class TestTransactionsFilters:
    def test_filter_by_account(self, client: TestClient) -> None:
        body = client.get("/api/v1/transactions", params={"account": "Credit Card"}).json()
        assert body["pagination"]["total"] == 1
        assert body["data"][0]["description"] == "Streaming Co"

    def test_filter_by_category(self, client: TestClient) -> None:
        body = client.get("/api/v1/transactions", params={"category": "dining"}).json()
        assert body["pagination"]["total"] == 1
        assert body["data"][0]["description"] == "Coffee Shop"

    def test_filter_by_date_range(self, client: TestClient) -> None:
        body = client.get(
            "/api/v1/transactions",
            params={"date_from": "2026-05-14", "date_to": "2026-05-21"},
        ).json()
        descs = {r["description"] for r in body["data"]}
        assert descs == {"Coffee Shop", "Paycheck"}
        assert body["pagination"]["total"] == 2

    def test_free_text_search(self, client: TestClient) -> None:
        body = client.get("/api/v1/transactions", params={"q": "coffee"}).json()
        assert body["pagination"]["total"] == 1
        assert body["data"][0]["description"] == "Coffee Shop"

    def test_limit_and_offset_paginate(self, client: TestClient) -> None:
        page1 = client.get("/api/v1/transactions", params={"limit": 2, "offset": 0}).json()
        page2 = client.get("/api/v1/transactions", params={"limit": 2, "offset": 2}).json()
        assert len(page1["data"]) == 2
        assert len(page2["data"]) == 1
        assert page1["pagination"] == {"limit": 2, "offset": 0, "total": 3}
        assert page2["pagination"] == {"limit": 2, "offset": 2, "total": 3}


@pytest.mark.slow
class TestTransactionsEdgeCases:
    def test_offset_past_end_returns_empty_data_with_correct_total(
        self, client: TestClient
    ) -> None:
        # DA-4: offset beyond the result set -> empty data, but total is still right.
        body = client.get("/api/v1/transactions", params={"offset": 999}).json()
        assert body["data"] == []
        assert body["pagination"]["total"] == 3
        assert body["pagination"]["offset"] == 999


@pytest.mark.slow
class TestTransactionsValidation:
    def test_limit_over_max_returns_canonical_422(self, client: TestClient) -> None:
        # DA-1: invalid query -> HTTP 422 + canonical envelope.
        resp = client.get("/api/v1/transactions", params={"limit": 201})
        assert resp.status_code == 422
        body = resp.json()
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert body["error"]["message"] == "Request validation failed."
        assert isinstance(body["error"]["details"], list)
        detail = body["error"]["details"][0]
        assert detail["field"] == "limit"
        assert detail["location"] == "query"
        assert set(detail.keys()) == {"field", "location", "message", "code"}

    def test_limit_below_min_returns_422(self, client: TestClient) -> None:
        resp = client.get("/api/v1/transactions", params={"limit": 0})
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_negative_offset_returns_422(self, client: TestClient) -> None:
        resp = client.get("/api/v1/transactions", params={"offset": -1})
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_invalid_date_returns_422(self, client: TestClient) -> None:
        resp = client.get("/api/v1/transactions", params={"date_from": "not-a-date"})
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_db_unavailable_returns_canonical_503() -> None:
    """DA-18: a DB connectivity failure -> canonical 503 body, identical to NestJS."""

    def _broken_db() -> Session:
        raise ServiceUnavailableError()

    app.dependency_overrides[get_db] = _broken_db
    try:
        with TestClient(app) as test_client:
            resp = test_client.get("/api/v1/transactions")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 503
    body = resp.json()
    assert body["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert body["error"]["details"] == []
