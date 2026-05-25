"""Tests for ``GET /api/v1/budget`` (P4.2).

Covers the contract the parity harness also asserts cross-backend:

* success: full design §3 shape composed from the precomputed aggregate tables,
  money decimal-string, percentages numeric (0-100), dates ``YYYY-MM-DD``,
  deterministic ordering (50/30/20 buckets, categories by name, monthly by month,
  recurring by merchant);
* the ``window`` selector scopes the aggregate rows;
* empty DB -> well-formed zeros + empty arrays;
* an unknown ``window`` -> empty arrays + zero rates (no recompute, DA-23);
* DB unavailable -> canonical **503** (DA-18).

All data is SYNTHETIC. A disposable Postgres-backed session is built against the
local docker-compose DB (also the CI Postgres service); rows are seeded per test
and rolled back, so the suite never touches real financial data and leaves no
residue.
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
from app.models import (
    BudgetAggregate,
    BudgetBucketAggregate,
    BudgetCategoryAggregate,
    BudgetMonthlyAggregate,
    RecurringCharge,
)

WINDOW = "12m"


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
    """Seed the budget aggregate tables with a synthetic ``12m`` window.

    Rows are deliberately inserted out of canonical order (savings before needs,
    March before February) so the endpoint's deterministic ordering is exercised.
    """
    db_session.execute(
        insert(BudgetAggregate),
        [
            {
                "window": WINDOW,
                "savings_rate": Decimal("22.0"),
                "effective_tax_rate": Decimal("18.5"),
            }
        ],
    )
    db_session.execute(
        insert(BudgetBucketAggregate),
        [
            {
                "window": WINDOW,
                "name": "savings",
                "target_pct": Decimal("20.0"),
                "actual_pct": Decimal("22.0"),
                "amount": Decimal("1100.00"),
            },
            {
                "window": WINDOW,
                "name": "needs",
                "target_pct": Decimal("50.0"),
                "actual_pct": Decimal("48.0"),
                "amount": Decimal("2400.00"),
            },
            {
                "window": WINDOW,
                "name": "wants",
                "target_pct": Decimal("30.0"),
                "actual_pct": Decimal("30.0"),
                "amount": Decimal("1500.00"),
            },
        ],
    )
    db_session.execute(
        insert(BudgetCategoryAggregate),
        [
            {"window": WINDOW, "name": "rent", "amount": Decimal("1800.00"), "bucket": "needs"},
            {"window": WINDOW, "name": "groceries", "amount": Decimal("420.00"), "bucket": "needs"},
        ],
    )
    db_session.execute(
        insert(BudgetMonthlyAggregate),
        [
            {
                "window": WINDOW,
                "month": "2026-03",
                "needs": Decimal("2400.00"),
                "wants": Decimal("1500.00"),
            },
            {
                "window": WINDOW,
                "month": "2026-02",
                "needs": Decimal("2350.00"),
                "wants": Decimal("1480.00"),
            },
        ],
    )
    db_session.execute(
        insert(RecurringCharge),
        [
            {
                "merchant": "Streaming Co",
                "category": "entertainment",
                "cadence": "monthly",
                "last_charged": date(2026, 5, 1),
                "monthly_est": Decimal("15.99"),
            },
            {
                "merchant": "Cloud Backup",
                "category": "software",
                "cadence": "monthly",
                "last_charged": date(2026, 5, 3),
                "monthly_est": Decimal("9.00"),
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
class TestBudgetSuccess:
    def test_returns_full_shape(self, client: TestClient) -> None:
        resp = client.get("/api/v1/budget")
        assert resp.status_code == 200
        body = resp.json()
        assert set(body.keys()) == {
            "savings_rate",
            "effective_tax_rate",
            "buckets",
            "categories",
            "monthly",
            "recurring",
        }

    def test_rates_are_numeric_percentages(self, client: TestClient) -> None:
        body = client.get("/api/v1/budget").json()
        # DA-22: percentages are JSON NUMBERS on a 0-100 scale, never strings.
        assert body["savings_rate"] == 22.0
        assert body["effective_tax_rate"] == 18.5
        assert isinstance(body["savings_rate"], (int, float))
        assert not isinstance(body["savings_rate"], str)

    def test_buckets_ordered_50_30_20_with_money_string_and_numeric_pct(
        self, client: TestClient
    ) -> None:
        body = client.get("/api/v1/budget").json()
        names = [b["name"] for b in body["buckets"]]
        assert names == ["needs", "wants", "savings"]  # canonical ordering
        needs = body["buckets"][0]
        assert needs["target_pct"] == 50.0
        assert needs["actual_pct"] == 48.0
        assert needs["amount"] == "2400.00"  # money is a decimal STRING (DA-2)
        assert isinstance(needs["amount"], str)
        assert isinstance(needs["target_pct"], (int, float))

    def test_categories_sorted_by_name(self, client: TestClient) -> None:
        body = client.get("/api/v1/budget").json()
        assert [c["name"] for c in body["categories"]] == ["groceries", "rent"]
        groceries = body["categories"][0]
        assert groceries["amount"] == "420.00"
        assert groceries["bucket"] == "needs"

    def test_monthly_sorted_by_month_money_string(self, client: TestClient) -> None:
        body = client.get("/api/v1/budget").json()
        assert [m["month"] for m in body["monthly"]] == ["2026-02", "2026-03"]
        feb = body["monthly"][0]
        assert feb["needs"] == "2350.00"
        assert feb["wants"] == "1480.00"

    def test_recurring_sorted_by_merchant_dates_and_money(self, client: TestClient) -> None:
        body = client.get("/api/v1/budget").json()
        merchants = [r["merchant"] for r in body["recurring"]]
        assert merchants == ["Cloud Backup", "Streaming Co"]
        streaming = next(r for r in body["recurring"] if r["merchant"] == "Streaming Co")
        assert streaming["category"] == "entertainment"
        assert streaming["cadence"] == "monthly"
        assert streaming["last_charged"] == "2026-05-01"  # YYYY-MM-DD (DA-3)
        assert streaming["monthly_est"] == "15.99"


@pytest.mark.slow
class TestBudgetWindow:
    def test_unknown_window_returns_zeros_and_empty_arrays(self, client: TestClient) -> None:
        # No recompute (DA-23): a window with no aggregate rows -> zeros/empties.
        body = client.get("/api/v1/budget", params={"window": "3m"}).json()
        assert body["savings_rate"] == 0
        assert body["effective_tax_rate"] == 0
        assert body["buckets"] == []
        assert body["categories"] == []
        assert body["monthly"] == []
        # recurring is window-independent, so it is still present.
        assert len(body["recurring"]) == 2


@pytest.mark.slow
class TestBudgetEmpty:
    def test_empty_db_returns_well_formed_zeros(self, empty_client: TestClient) -> None:
        resp = empty_client.get("/api/v1/budget")
        assert resp.status_code == 200
        body = resp.json()
        assert body["savings_rate"] == 0
        assert body["effective_tax_rate"] == 0
        assert body["buckets"] == []
        assert body["categories"] == []
        assert body["monthly"] == []
        assert body["recurring"] == []


def test_db_unavailable_returns_canonical_503() -> None:
    """DA-18: a DB connectivity failure -> canonical 503 body, identical to NestJS."""

    def _broken_db() -> Session:
        raise ServiceUnavailableError()

    app.dependency_overrides[get_db] = _broken_db
    try:
        with TestClient(app) as test_client:
            resp = test_client.get("/api/v1/budget")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 503
    body = resp.json()
    assert body["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert body["error"]["details"] == []
