"""Tests for the E*TRADE holdings snapshot loader (P8.1).

Pure-parse tests need no DB; the snapshot-replace integration tests run against
the live Postgres inside a rolled-back transaction. All fixtures are
**synthetic** (fabricated symbols/values; data-privacy).
"""

from __future__ import annotations

from collections.abc import Iterator
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import engine
from app.ingestion.holdings_loader import (
    HoldingRow,
    holding_count,
    load_holdings,
    parse_holdings,
)
from app.models import Holding

# A synthetic E*TRADE export: preamble lines, then the 10-col positions header.
ETRADE_CSV = (
    "Account Summary,,,,,,,,,\n"
    "As of: 01/01/2026,,,,,,,,,\n"
    "\n"
    "Symbol,Last Price $,Change $,Change %,Qty #,Price Paid $,Day's Gain $,"
    "Total Gain $,Total Gain %,Value $\n"
    "FNDX,50.00,0.10,0.2,10,40.00,1.00,100.00,25.0,500.00\n"
    "VOO,400.00,1.00,0.3,5,350.00,5.00,250.00,14.3,2000.00\n"
    "CASH,,,,,,,,,250.00\n"
    "TOTAL,,,,,,,,,2750.00\n"
)


@pytest.fixture
def db_session() -> Iterator[Session]:
    """A session inside a rolled-back transaction (no rows persist)."""
    try:
        connection = engine.connect()
    except Exception as exc:  # pragma: no cover - only without a DB
        pytest.skip(f"Postgres not available: {exc}")
    transaction = connection.begin()
    session = Session(bind=connection)
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


class TestParseHoldings:
    def test_parses_positions_skipping_cash_and_total(self) -> None:
        rows = parse_holdings(ETRADE_CSV)
        symbols = [r.symbol for r in rows]
        assert symbols == ["FNDX", "VOO"]  # CASH + TOTAL summary rows skipped

    def test_value_and_gain_columns(self) -> None:
        rows = {r.symbol: r for r in parse_holdings(ETRADE_CSV)}
        assert rows["FNDX"].value == Decimal("500.00")
        assert rows["FNDX"].gain == Decimal("100.00")
        assert rows["VOO"].value == Decimal("2000.00")

    def test_no_header_returns_empty(self) -> None:
        assert parse_holdings("just,some,random\n1,2,3\n") == []

    def test_money_parses_dollar_and_commas(self) -> None:
        csv = 'Symbol,a,b,c,d,e,f,Total Gain $,h,Value $\nBIG,,,,,,,"$1,234.50",,"$10,000.00"\n'
        rows = parse_holdings(csv)
        assert rows[0].value == Decimal("10000.00")
        assert rows[0].gain == Decimal("1234.50")


class TestLoadHoldings:
    def test_load_inserts_and_computes_weight(self, db_session: Session) -> None:
        rows = [
            HoldingRow("AAA", Decimal("750.00"), Decimal("50.00")),
            HoldingRow("BBB", Decimal("250.00"), Decimal("-10.00")),
        ]
        count = load_holdings(db_session, rows)
        db_session.flush()
        assert count == 2
        loaded = {h.symbol: h for h in db_session.scalars(select(Holding)).all()}
        # weight = share of total value (1000.00): 75.0% / 25.0%.
        assert loaded["AAA"].weight == Decimal("75.0")
        assert loaded["BBB"].weight == Decimal("25.0")
        assert loaded["BBB"].gain == Decimal("-10.00")

    def test_snapshot_replaces_prior_rows(self, db_session: Session) -> None:
        load_holdings(db_session, [HoldingRow("OLD", Decimal("100.00"), Decimal("0.00"))])
        db_session.flush()
        load_holdings(db_session, [HoldingRow("NEW", Decimal("200.00"), Decimal("0.00"))])
        db_session.flush()
        symbols = [h.symbol for h in db_session.scalars(select(Holding)).all()]
        assert symbols == ["NEW"]  # the OLD snapshot was replaced

    def test_empty_clears_table(self, db_session: Session) -> None:
        load_holdings(db_session, [HoldingRow("X", Decimal("1.00"), Decimal("0.00"))])
        db_session.flush()
        count = load_holdings(db_session, [])
        db_session.flush()
        assert count == 0
        assert holding_count(db_session) == 0

    def test_zero_total_value_weights_are_zero(self, db_session: Session) -> None:
        load_holdings(db_session, [HoldingRow("Z", Decimal("0.00"), Decimal("0.00"))])
        db_session.flush()
        z = db_session.scalars(select(Holding)).one()
        assert z.weight == Decimal("0.0")
