"""Tests for ``GET /api/v1/networth`` (P4.3).

Covers the contract the parity harness also asserts cross-backend:

* success: full design §3 shape composed from the ``accounts`` table — totals
  (``net_worth``/``assets``/``liabilities``) as money decimal-strings, accounts
  sorted by name, ``delta_30d`` a well-formed ``"0.00"``, ``series`` empty (no
  history source);
* the signed-balance convention: positive balances are assets, negative balances
  are liabilities, ``net_worth`` is their net;
* a null account balance counts as 0;
* empty DB -> well-formed zeros + empty arrays;
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
from app.models import Account


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
    """Seed synthetic accounts spanning assets, a liability, and a null balance.

    Rows are deliberately inserted out of name order (Roth, Brokerage, Visa,
    Checking) so the endpoint's deterministic name ordering is exercised.
    """
    db_session.execute(
        insert(Account),
        [
            {"name": "Roth IRA", "type": "retirement", "balance": Decimal("90000.00")},
            {"name": "Brokerage", "type": "investment", "balance": Decimal("60000.00")},
            {"name": "Visa", "type": "credit", "balance": Decimal("-26560.00")},
            {"name": "Checking", "type": "depository", "balance": Decimal("28900.00")},
            # A null balance counts as 0 and never shifts the totals.
            {"name": "Unfunded", "type": "depository", "balance": None},
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
class TestNetworthSuccess:
    def test_returns_full_shape(self, client: TestClient) -> None:
        resp = client.get("/api/v1/networth")
        assert resp.status_code == 200
        body = resp.json()
        assert set(body.keys()) == {
            "net_worth",
            "assets",
            "liabilities",
            "series",
            "accounts",
        }

    def test_totals_are_money_strings_with_signed_convention(self, client: TestClient) -> None:
        body = client.get("/api/v1/networth").json()
        # assets = 90000 + 60000 + 28900 = 178900; liabilities = 26560 (abs of -26560).
        assert body["assets"] == "178900.00"
        assert body["liabilities"] == "26560.00"
        # net_worth = assets - liabilities.
        assert body["net_worth"] == "152340.00"
        # Money is a decimal STRING (DA-2), never a JSON number.
        assert isinstance(body["assets"], str)
        assert isinstance(body["net_worth"], str)

    def test_accounts_sorted_by_name_with_zero_delta(self, client: TestClient) -> None:
        body = client.get("/api/v1/networth").json()
        names = [a["name"] for a in body["accounts"]]
        assert names == ["Brokerage", "Checking", "Roth IRA", "Unfunded", "Visa"]
        brokerage = body["accounts"][0]
        assert brokerage["type"] == "investment"
        assert brokerage["balance"] == "60000.00"
        # No balance history -> a well-formed zero delta (DA: never clock-derived).
        assert brokerage["delta_30d"] == "0.00"
        assert isinstance(brokerage["delta_30d"], str)

    def test_null_balance_counts_as_zero(self, client: TestClient) -> None:
        body = client.get("/api/v1/networth").json()
        unfunded = next(a for a in body["accounts"] if a["name"] == "Unfunded")
        assert unfunded["balance"] == "0.00"
        liability = next(a for a in body["accounts"] if a["name"] == "Visa")
        # The liability account keeps its signed balance in the per-account row.
        assert liability["balance"] == "-26560.00"

    def test_series_is_empty_no_history(self, client: TestClient) -> None:
        # No history source -> series is empty; neither backend fabricates it.
        body = client.get("/api/v1/networth").json()
        assert body["series"] == []

    def test_window_param_does_not_change_snapshot(self, client: TestClient) -> None:
        # `window` is accepted for contract parity but does not alter the snapshot.
        body = client.get("/api/v1/networth", params={"window": "3m"}).json()
        assert body["net_worth"] == "152340.00"


@pytest.mark.slow
class TestNetworthEmpty:
    def test_empty_db_returns_well_formed_zeros(self, empty_client: TestClient) -> None:
        resp = empty_client.get("/api/v1/networth")
        assert resp.status_code == 200
        body = resp.json()
        assert body["net_worth"] == "0.00"
        assert body["assets"] == "0.00"
        assert body["liabilities"] == "0.00"
        assert body["series"] == []
        assert body["accounts"] == []


def test_db_unavailable_returns_canonical_503() -> None:
    """DA-18: a DB connectivity failure -> canonical 503 body, identical to NestJS."""

    def _broken_db() -> Session:
        raise ServiceUnavailableError()

    app.dependency_overrides[get_db] = _broken_db
    try:
        with TestClient(app) as test_client:
            resp = test_client.get("/api/v1/networth")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 503
    body = resp.json()
    assert body["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert body["error"]["details"] == []
