"""Tests for ``GET /api/v1/goals`` (P4.6).

Covers the contract the parity harness also asserts cross-backend:

* success: full design §3 shape composed from the ``goals`` table — ``target``
  and ``saved`` summed (money decimal-string), ``progress_pct`` numeric (0-100),
  ``funding[]`` one per goal sorted by name, ``affordability`` zero-filled;
* empty DB -> well-formed zeros + empty ``funding``;
* DB unavailable -> canonical **503** (DA-18).

All data is SYNTHETIC. A disposable Postgres-backed session is built against the
local docker-compose DB (also the CI Postgres service); rows are seeded per test
and rolled back, so the suite never touches real financial data and leaves no
residue.
"""

from __future__ import annotations

from collections.abc import Iterator
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import insert
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
from app.errors import ServiceUnavailableError
from app.main import app
from app.models import Goal

ZERO_AFFORDABILITY = {
    "price": "0.00",
    "down_payment": "0.00",
    "mortgage": "0.00",
    "monthly_piti": "0.00",
    "income_share": 0,
}


@pytest.fixture
def db_session() -> Iterator[Session]:
    """A Postgres session wrapped in a transaction rolled back on teardown.

    Synthetic rows seeded inside a test are discarded afterwards (no residue,
    no real data).
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
    """Seed the ``goals`` table with synthetic rows.

    Rows are inserted out of name order (``Vacation`` before ``Emergency Fund``)
    so the endpoint's deterministic name ordering is exercised. Totals:
    target 60000, saved 21000 -> progress 35.0%.
    """
    db_session.execute(
        insert(Goal),
        [
            {"name": "Vacation", "target": Decimal("10000.00"), "saved": Decimal("6000.00")},
            {
                "name": "Emergency Fund",
                "target": Decimal("50000.00"),
                "saved": Decimal("15000.00"),
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


@pytest.fixture
def empty_client(db_session: Session) -> Iterator[TestClient]:
    """TestClient over an EMPTY (un-seeded) transactional session."""
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.mark.slow
class TestGoalsSuccess:
    def test_returns_full_shape(self, client: TestClient) -> None:
        resp = client.get("/api/v1/goals")
        assert resp.status_code == 200
        body = resp.json()
        assert set(body.keys()) == {
            "target",
            "saved",
            "progress_pct",
            "funding",
            "affordability",
        }

    def test_target_and_saved_are_summed_money_strings(self, client: TestClient) -> None:
        body = client.get("/api/v1/goals").json()
        # Money is a decimal STRING (DA-2); values are summed across goals.
        assert body["target"] == "60000.00"
        assert body["saved"] == "21000.00"
        assert isinstance(body["target"], str)

    def test_progress_pct_is_numeric_percentage(self, client: TestClient) -> None:
        body = client.get("/api/v1/goals").json()
        # DA-22: percentage is a JSON NUMBER on a 0-100 scale, never a string.
        assert body["progress_pct"] == 35.0
        assert isinstance(body["progress_pct"], (int, float))
        assert not isinstance(body["progress_pct"], str)

    def test_funding_sorted_by_name_money_strings(self, client: TestClient) -> None:
        body = client.get("/api/v1/goals").json()
        sources = [f["source"] for f in body["funding"]]
        assert sources == ["Emergency Fund", "Vacation"]  # sorted by name
        assert body["funding"][0]["amount"] == "15000.00"
        assert body["funding"][1]["amount"] == "6000.00"
        assert isinstance(body["funding"][0]["amount"], str)

    def test_affordability_is_zero_filled_block(self, client: TestClient) -> None:
        body = client.get("/api/v1/goals").json()
        assert body["affordability"] == ZERO_AFFORDABILITY


@pytest.mark.slow
class TestGoalsEmpty:
    def test_empty_db_returns_well_formed_zeros(self, empty_client: TestClient) -> None:
        resp = empty_client.get("/api/v1/goals")
        assert resp.status_code == 200
        body = resp.json()
        assert body == {
            "target": "0.00",
            "saved": "0.00",
            "progress_pct": 0,
            "funding": [],
            "affordability": ZERO_AFFORDABILITY,
        }


def test_db_unavailable_returns_canonical_503() -> None:
    """DA-18: a DB connectivity failure -> canonical 503 body, identical to NestJS."""

    def _broken_db() -> Session:
        raise ServiceUnavailableError()

    app.dependency_overrides[get_db] = _broken_db
    try:
        with TestClient(app) as test_client:
            resp = test_client.get("/api/v1/goals")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 503
    body = resp.json()
    assert body["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert body["error"]["details"] == []
