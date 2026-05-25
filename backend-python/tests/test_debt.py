"""Tests for ``GET /api/v1/debt`` (P4.5).

Covers the contract the parity harness also asserts cross-backend:

* success: full design §3 shape composed from the ``loans`` table — money
  decimal-string, rates numeric (0-100), ``loan_priority``/``payoff_strategy``
  enums per the registry, deterministic ordering (loans + tranches by rate desc);
* BOTH payoff projections (avalanche highest-rate-first vs minimums-only) are
  returned and avalanche clears the debt no later than minimums with no more
  interest;
* the ``strategy`` query param validates against the registry (unknown -> 422)
  but does NOT change the response shape;
* empty DB -> well-formed zeros + empty arrays + two zero projections;
* DB unavailable -> canonical **503** (DA-18).

All data is SYNTHETIC. A disposable Postgres-backed session is built against the
local DB (also the CI Postgres service); rows are seeded per test and rolled
back, so the suite never touches real financial data and leaves no residue.
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
from app.models import Loan
from app.routers.debt import (
    _months_to_year,
    _weighted_avg_rate,
    project_payoff,
)
from app.schemas import LoanOut


@pytest.fixture
def db_session() -> Iterator[Session]:
    """A Postgres session wrapped in a transaction rolled back on teardown."""
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
    """Seed three synthetic loans (deliberately out of rate order).

    Rates/priorities span the registry so ordering + tranche grouping + both
    payoff strategies are exercised.
    """
    db_session.execute(
        insert(Loan),
        [
            {
                "name": "Loan B",
                "balance": Decimal("8000.00"),
                "rate": Decimal("4.5"),
                "minimum_payment": Decimal("100.00"),
                "priority": "then",
            },
            {
                "name": "Loan A",
                "balance": Decimal("12000.00"),
                "rate": Decimal("6.8"),
                "minimum_payment": Decimal("150.00"),
                "priority": "pay_first",
            },
            {
                "name": "Loan C",
                "balance": Decimal("6560.00"),
                "rate": Decimal("3.2"),
                "minimum_payment": Decimal("70.00"),
                "priority": "minimums",
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
class TestDebtSuccess:
    def test_returns_full_shape(self, client: TestClient) -> None:
        resp = client.get("/api/v1/debt")
        assert resp.status_code == 200
        body = resp.json()
        assert set(body.keys()) == {
            "total",
            "weighted_avg_rate",
            "monthly_minimum",
            "tranches",
            "payoff",
            "loans",
        }

    def test_totals_money_string_and_numeric_rate(self, client: TestClient) -> None:
        body = client.get("/api/v1/debt").json()
        assert body["total"] == "26560.00"  # money is a decimal STRING (DA-2)
        assert isinstance(body["total"], str)
        assert body["monthly_minimum"] == "320.00"
        # DA-22: weighted-average rate is a JSON NUMBER, 0-100, one decimal.
        assert body["weighted_avg_rate"] == 5.2
        assert isinstance(body["weighted_avg_rate"], (int, float))
        assert not isinstance(body["weighted_avg_rate"], str)

    def test_loans_ordered_by_rate_desc_with_money_and_enum(self, client: TestClient) -> None:
        body = client.get("/api/v1/debt").json()
        assert [loan["name"] for loan in body["loans"]] == ["Loan A", "Loan B", "Loan C"]
        first = body["loans"][0]
        assert first["balance"] == "12000.00"
        assert first["minimum_payment"] == "150.00"
        assert first["rate"] == 6.8
        assert first["priority"] == "pay_first"  # enum per registry (DA-5)

    def test_tranches_grouped_and_ordered_by_rate_desc(self, client: TestClient) -> None:
        body = client.get("/api/v1/debt").json()
        assert [t["rate"] for t in body["tranches"]] == [6.8, 4.5, 3.2]
        top = body["tranches"][0]
        assert top["balance"] == "12000.00"
        assert top["loan_count"] == 1
        assert top["priority"] == "pay_first"

    def test_payoff_has_both_strategies(self, client: TestClient) -> None:
        body = client.get("/api/v1/debt").json()
        strategies = [p["strategy"] for p in body["payoff"]]
        # Both registry strategies present, avalanche first.
        assert strategies == ["avalanche", "minimums"]
        for proj in body["payoff"]:
            assert isinstance(proj["total_interest"], str)  # money string
            assert isinstance(proj["debt_free_year"], int)

    def test_avalanche_beats_minimums(self, client: TestClient) -> None:
        body = client.get("/api/v1/debt").json()
        aval = next(p for p in body["payoff"] if p["strategy"] == "avalanche")
        mins = next(p for p in body["payoff"] if p["strategy"] == "minimums")
        # Highest-rate-first acceleration clears no later, with no more interest.
        assert aval["debt_free_year"] <= mins["debt_free_year"]
        assert Decimal(aval["total_interest"]) <= Decimal(mins["total_interest"])


@pytest.mark.slow
class TestDebtStrategyParam:
    def test_known_strategy_does_not_change_shape(self, client: TestClient) -> None:
        base = client.get("/api/v1/debt").json()
        for strategy in ("avalanche", "minimums"):
            scoped = client.get("/api/v1/debt", params={"strategy": strategy}).json()
            # The param is accepted but the body is identical (both projections).
            assert scoped == base

    def test_unknown_strategy_returns_canonical_422(self, client: TestClient) -> None:
        resp = client.get("/api/v1/debt", params={"strategy": "snowball"})
        assert resp.status_code == 422
        body = resp.json()
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert any(d["field"] == "strategy" for d in body["error"]["details"])


@pytest.mark.slow
class TestDebtEmpty:
    def test_empty_db_returns_well_formed_zeros(self, empty_client: TestClient) -> None:
        resp = empty_client.get("/api/v1/debt")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == "0.00"
        assert body["monthly_minimum"] == "0.00"
        assert body["weighted_avg_rate"] == 0
        assert body["tranches"] == []
        assert body["loans"] == []
        # Two zero-interest projections (debt_free_year 0) — shape stays stable.
        assert [p["strategy"] for p in body["payoff"]] == ["avalanche", "minimums"]
        for proj in body["payoff"]:
            assert proj["debt_free_year"] == 0
            assert proj["total_interest"] == "0.00"


def test_db_unavailable_returns_canonical_503() -> None:
    """DA-18: a DB connectivity failure -> canonical 503 body, identical to NestJS."""

    def _broken_db() -> Session:
        raise ServiceUnavailableError()

    app.dependency_overrides[get_db] = _broken_db
    try:
        with TestClient(app) as test_client:
            resp = test_client.get("/api/v1/debt")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 503
    body = resp.json()
    assert body["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert body["error"]["details"] == []


# --- Unit tests for the deterministic payoff projection (no DB) -------------


def test_project_payoff_empty_returns_zero() -> None:
    months, interest = project_payoff([], accelerate=True)
    assert months == 0
    assert interest == Decimal("0")


def test_months_to_year_zero_is_zero() -> None:
    assert _months_to_year(0) == 0


def test_months_to_year_advances_by_year() -> None:
    # Month 1 = Jan 2026; month 12 still 2026; month 13 -> 2027.
    assert _months_to_year(1) == 2026
    assert _months_to_year(12) == 2026
    assert _months_to_year(13) == 2027


def test_weighted_avg_rate_zero_balance() -> None:
    loans = [
        LoanOut(
            name="Paid",
            balance=Decimal("0.00"),
            rate=Decimal("5.0"),
            minimum_payment=Decimal("0.00"),
            priority="minimums",
        )
    ]
    assert _weighted_avg_rate(loans) == Decimal(0)


def test_non_amortizing_loan_hits_horizon() -> None:
    # Minimum below the monthly interest -> never clears -> capped horizon.
    loans = [
        LoanOut(
            name="Stuck",
            balance=Decimal("10000.00"),
            rate=Decimal("24.0"),
            minimum_payment=Decimal("50.00"),
            priority="pay_first",
        )
    ]
    months, _ = project_payoff(loans, accelerate=False)
    assert months == 600
