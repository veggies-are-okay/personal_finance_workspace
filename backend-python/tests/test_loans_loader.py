"""Tests for the flexible loan CSV snapshot loader (P8.1).

Pure-parse tests assert header-variant tolerance; integration tests run against
the live Postgres inside a rolled-back transaction. Fixtures are **synthetic**.
"""

from __future__ import annotations

from collections.abc import Iterator
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import engine
from app.ingestion.loans_loader import (
    LoanRow,
    load_loans,
    loan_count,
    parse_loans,
)
from app.models import Loan

# Canonical-ish headers.
LOANS_CSV = (
    "name,balance,interest rate,minimum payment\n"
    "Synthetic Loan A,10000.00,6.80,120.00\n"
    "Synthetic Loan B,5000.00,4.50,60.00\n"
)
# Variant headers (servicer/principal/apr/payment) + $/% noise.
VARIANT_CSV = 'Servicer,Principal,APR,Payment\nMade-Up Servicer,"$12,500.00",5.25%,"$150.00"\n'


@pytest.fixture
def db_session() -> Iterator[Session]:
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


class TestParseLoans:
    def test_canonical_headers(self) -> None:
        rows = {r.name: r for r in parse_loans(LOANS_CSV)}
        assert rows["Synthetic Loan A"].balance == Decimal("10000.00")
        assert rows["Synthetic Loan A"].rate == Decimal("6.80")
        assert rows["Synthetic Loan A"].minimum_payment == Decimal("120.00")

    def test_variant_headers_and_currency_noise(self) -> None:
        rows = parse_loans(VARIANT_CSV)
        assert len(rows) == 1
        loan = rows[0]
        assert loan.name == "Made-Up Servicer"
        assert loan.balance == Decimal("12500.00")  # $ + comma stripped
        assert loan.rate == Decimal("5.25")  # % stripped
        assert loan.minimum_payment == Decimal("150.00")

    def test_empty_document_returns_empty(self) -> None:
        assert parse_loans("") == []

    def test_row_without_name_skipped(self) -> None:
        rows = parse_loans("balance,rate\n100.00,5.0\n")
        assert rows == []

    def test_blank_lines_skipped(self) -> None:
        csv = "name,balance,rate,minimum payment\n\nLoan X,1.00,1.0,1.00\n\n"
        rows = parse_loans(csv)
        assert [r.name for r in rows] == ["Loan X"]


class TestLoadLoans:
    def test_load_inserts_rows_with_default_priority(self, db_session: Session) -> None:
        rows = parse_loans(LOANS_CSV)
        count = load_loans(db_session, rows)
        db_session.flush()
        assert count == 2
        loaded = {loan.name: loan for loan in db_session.scalars(select(Loan)).all()}
        assert loaded["Synthetic Loan A"].balance == Decimal("10000.00")
        # priority is not in a raw export; defaults to a valid enum value.
        assert loaded["Synthetic Loan A"].priority == "minimums"

    def test_snapshot_replaces_prior_rows(self, db_session: Session) -> None:
        load_loans(db_session, [LoanRow("Old", Decimal("1.00"), Decimal("1.0"), Decimal("1.00"))])
        db_session.flush()
        load_loans(db_session, [LoanRow("New", Decimal("2.00"), Decimal("2.0"), Decimal("2.00"))])
        db_session.flush()
        names = [loan.name for loan in db_session.scalars(select(Loan)).all()]
        assert names == ["New"]

    def test_empty_clears_table(self, db_session: Session) -> None:
        load_loans(db_session, [LoanRow("X", Decimal("1.00"), Decimal("1.0"), Decimal("1.00"))])
        db_session.flush()
        assert load_loans(db_session, []) == 0
        db_session.flush()
        assert loan_count(db_session) == 0
