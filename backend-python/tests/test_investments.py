"""Tests for ``GET /api/v1/investments`` (P4.4).

Covers the contract the parity harness also asserts cross-backend:

* success: full design §3 shape derived from the ``holdings`` table — portfolio
  totals + allocation/concentration/holdings; money decimal-string, percentages
  numeric (0-100), deterministic ordering (allocation by class, concentration by
  descending weight, holdings by symbol);
* allocation ``target_pct`` (sum of stored weights) vs ``actual_pct`` (market
  share) are derived correctly, including a NULL ``asset_class`` -> ``unclassified``;
* empty DB -> ``"0.00"`` totals + empty arrays;
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
from app.models import Holding


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
    """Seed the holdings table with a synthetic portfolio.

    Rows are inserted out of symbol order so the endpoint's deterministic
    ordering is exercised. Portfolio value = 27000 + 18000 + 5000 = 50000.
      * equities (VTI 27000 + VXUS 18000 = 45000) -> actual 90.0%
        target = stored weights 45.0 + 35.0 = 80.0%
      * bonds   (BND 5000)                        -> actual 10.0%, target 20.0%
    Concentration ranks by market share: VTI 54.0%, VXUS 36.0%, BND 10.0%.
    """
    db_session.execute(
        insert(Holding),
        [
            {
                "symbol": "VXUS",
                "name": "Total Intl ETF",
                "value": Decimal("18000.00"),
                "weight": Decimal("35.0"),
                "gain": Decimal("1500.00"),
                "asset_class": "equities",
            },
            {
                "symbol": "VTI",
                "name": "Total Market ETF",
                "value": Decimal("27000.00"),
                "weight": Decimal("45.0"),
                "gain": Decimal("3600.00"),
                "asset_class": "equities",
            },
            {
                "symbol": "BND",
                "name": "Total Bond ETF",
                "value": Decimal("5000.00"),
                "weight": Decimal("20.0"),
                "gain": Decimal("-200.00"),
                "asset_class": "bonds",
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
class TestInvestmentsSuccess:
    def test_returns_full_shape(self, client: TestClient) -> None:
        resp = client.get("/api/v1/investments")
        assert resp.status_code == 200
        body = resp.json()
        assert set(body.keys()) == {
            "portfolio_value",
            "unrealized_gain",
            "allocation",
            "concentration",
            "holdings",
        }

    def test_totals_are_money_strings(self, client: TestClient) -> None:
        body = client.get("/api/v1/investments").json()
        # DA-2: money is a decimal STRING, never a JSON number.
        assert body["portfolio_value"] == "50000.00"
        assert body["unrealized_gain"] == "4900.00"  # 3600 + 1500 - 200
        assert isinstance(body["portfolio_value"], str)
        assert isinstance(body["unrealized_gain"], str)

    def test_allocation_ordered_by_class_with_target_and_actual(self, client: TestClient) -> None:
        body = client.get("/api/v1/investments").json()
        # Allocation sorted by class name: bonds, equities.
        assert [a["class"] for a in body["allocation"]] == ["bonds", "equities"]
        bonds = body["allocation"][0]
        equities = body["allocation"][1]

        # actual_pct = market share; target_pct = sum of stored per-holding weights.
        assert bonds["actual_pct"] == 10.0
        assert bonds["target_pct"] == 20.0
        assert bonds["amount"] == "5000.00"
        assert equities["actual_pct"] == 90.0  # 45000 / 50000
        assert equities["target_pct"] == 80.0  # 45.0 + 35.0
        assert equities["amount"] == "45000.00"

        # DA-22: percentages are JSON NUMBERS; amounts are decimal STRINGS.
        assert isinstance(equities["actual_pct"], (int, float))
        assert not isinstance(equities["actual_pct"], str)
        assert isinstance(equities["amount"], str)

    def test_concentration_ordered_by_descending_weight(self, client: TestClient) -> None:
        body = client.get("/api/v1/investments").json()
        # Ranked by market share desc: VTI 54%, VXUS 36%, BND 10%.
        assert [c["holding"] for c in body["concentration"]] == ["VTI", "VXUS", "BND"]
        assert body["concentration"][0]["weight"] == 54.0
        assert body["concentration"][1]["weight"] == 36.0
        assert body["concentration"][2]["weight"] == 10.0
        assert isinstance(body["concentration"][0]["weight"], (int, float))

    def test_holdings_ordered_by_symbol_with_money_and_weight(self, client: TestClient) -> None:
        body = client.get("/api/v1/investments").json()
        assert [h["symbol"] for h in body["holdings"]] == ["BND", "VTI", "VXUS"]
        vti = next(h for h in body["holdings"] if h["symbol"] == "VTI")
        assert vti["name"] == "Total Market ETF"
        assert vti["value"] == "27000.00"  # money string
        assert vti["gain"] == "3600.00"
        assert vti["weight"] == 45.0  # stored per-holding weight, numeric
        assert isinstance(vti["value"], str)
        assert isinstance(vti["weight"], (int, float))

    def test_negative_gain_serialized_as_signed_money_string(self, client: TestClient) -> None:
        body = client.get("/api/v1/investments").json()
        bnd = next(h for h in body["holdings"] if h["symbol"] == "BND")
        assert bnd["gain"] == "-200.00"


@pytest.mark.slow
class TestInvestmentsUnclassified:
    def test_null_asset_class_grouped_as_unclassified(self, db_session: Session) -> None:
        # A holding with a NULL asset_class must bucket into "unclassified".
        db_session.execute(
            insert(Holding),
            [
                {
                    "symbol": "CASHX",
                    "name": "Money Market",
                    "value": Decimal("1000.00"),
                    "weight": Decimal("100.0"),
                    "gain": Decimal("0.00"),
                    "asset_class": None,
                }
            ],
        )
        db_session.flush()
        app.dependency_overrides[get_db] = lambda: db_session
        try:
            with TestClient(app) as test_client:
                body = test_client.get("/api/v1/investments").json()
        finally:
            app.dependency_overrides.clear()
        assert [a["class"] for a in body["allocation"]] == ["unclassified"]
        assert body["allocation"][0]["actual_pct"] == 100.0
        assert body["allocation"][0]["target_pct"] == 100.0


@pytest.mark.slow
class TestInvestmentsEmpty:
    def test_empty_db_returns_zeros_and_empty_arrays(self, empty_client: TestClient) -> None:
        resp = empty_client.get("/api/v1/investments")
        assert resp.status_code == 200
        body = resp.json()
        assert body["portfolio_value"] == "0.00"
        assert body["unrealized_gain"] == "0.00"
        assert body["allocation"] == []
        assert body["concentration"] == []
        assert body["holdings"] == []


@pytest.mark.slow
class TestInvestmentsZeroPortfolio:
    def test_zero_value_holdings_avoid_division_by_zero(self, db_session: Session) -> None:
        # A holding worth 0 makes portfolio_value == 0 with rows PRESENT: the
        # percentage guard must return 0%, never raise ZeroDivisionError.
        db_session.execute(
            insert(Holding),
            [
                {
                    "symbol": "ZERO",
                    "name": "Worthless Position",
                    "value": Decimal("0.00"),
                    "weight": Decimal("0.0"),
                    "gain": Decimal("0.00"),
                    "asset_class": "equities",
                }
            ],
        )
        db_session.flush()
        app.dependency_overrides[get_db] = lambda: db_session
        try:
            with TestClient(app) as test_client:
                resp = test_client.get("/api/v1/investments")
        finally:
            app.dependency_overrides.clear()
        assert resp.status_code == 200
        body = resp.json()
        assert body["portfolio_value"] == "0.00"
        assert body["allocation"][0]["actual_pct"] == 0.0
        assert body["concentration"][0]["weight"] == 0.0


def test_db_query_failure_maps_to_canonical_503() -> None:
    """A SQLAlchemyError raised by the query is mapped to the canonical 503 (DA-18)."""
    from unittest.mock import MagicMock

    from sqlalchemy.exc import OperationalError

    broken = MagicMock(spec=Session)
    broken.scalars.side_effect = OperationalError("SELECT", {}, Exception("boom"))

    app.dependency_overrides[get_db] = lambda: broken
    try:
        with TestClient(app) as test_client:
            resp = test_client.get("/api/v1/investments")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "SERVICE_UNAVAILABLE"


def test_db_unavailable_returns_canonical_503() -> None:
    """DA-18: a DB connectivity failure -> canonical 503 body, identical to NestJS."""

    def _broken_db() -> Session:
        raise ServiceUnavailableError()

    app.dependency_overrides[get_db] = _broken_db
    try:
        with TestClient(app) as test_client:
            resp = test_client.get("/api/v1/investments")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 503
    body = resp.json()
    assert body["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert body["error"]["details"] == []
