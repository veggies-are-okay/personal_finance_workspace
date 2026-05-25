"""Integration tests for the idempotent income loader (P3.2).

Run against the **live Postgres** (docker-compose / CI service container)
because the loader uses ``INSERT ... ON CONFLICT``. Each test runs inside a
transaction that is rolled back on teardown. All fixtures are **synthetic** —
fabricated employers, amounts, and dates (``.claude/rules/data-privacy.md``).
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import engine
from app.ingestion.income_loader import (
    PaystubRow,
    compute_dedupe_key,
    load_paystubs,
    paystub_count,
)
from app.models import Paystub


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


SYNTHETIC_PAYSTUBS = [
    PaystubRow(
        employer="Acme Co",
        period_start=date(2026, 1, 1),
        period_end=date(2026, 1, 15),
        pay_date=date(2026, 1, 15),
        gross_pay=Decimal("5000.00"),
        net_pay=Decimal("3500.00"),
        taxes=Decimal("1200.00"),
        deductions=Decimal("300.00"),
        reimbursements=Decimal("0.00"),
        retirement_401k_employee=Decimal("250.00"),
        retirement_401k_employer=Decimal("125.00"),
    ),
    PaystubRow(
        employer="Acme Co",
        period_start=date(2026, 1, 16),
        period_end=date(2026, 1, 31),
        pay_date=date(2026, 1, 31),
        gross_pay=Decimal("5000.00"),
        net_pay=Decimal("3500.00"),
        taxes=Decimal("1200.00"),
        deductions=Decimal("300.00"),
    ),
]


class TestIncomeDedupeKey:
    def test_deterministic(self) -> None:
        a = compute_dedupe_key("Acme Co", date(2026, 1, 15), Decimal("5000"), Decimal("3500"))
        b = compute_dedupe_key("Acme Co", date(2026, 1, 15), Decimal("5000.00"), Decimal("3500.00"))
        assert a == b

    def test_distinct_pay_dates_differ(self) -> None:
        a = compute_dedupe_key("Acme Co", date(2026, 1, 15), Decimal("5000"), Decimal("3500"))
        b = compute_dedupe_key("Acme Co", date(2026, 1, 31), Decimal("5000"), Decimal("3500"))
        assert a != b


class TestLoadPaystubs:
    def test_load_inserts_rows(self, db_session: Session) -> None:
        before = paystub_count(db_session)
        processed = load_paystubs(db_session, SYNTHETIC_PAYSTUBS)
        db_session.flush()
        assert processed == len(SYNTHETIC_PAYSTUBS)
        assert paystub_count(db_session) == before + len(SYNTHETIC_PAYSTUBS)

    def test_double_load_is_idempotent(self, db_session: Session) -> None:
        before = paystub_count(db_session)
        load_paystubs(db_session, SYNTHETIC_PAYSTUBS)
        db_session.flush()
        after_first = paystub_count(db_session)
        load_paystubs(db_session, SYNTHETIC_PAYSTUBS)
        db_session.flush()
        after_second = paystub_count(db_session)
        assert after_first == before + len(SYNTHETIC_PAYSTUBS)
        assert after_second == after_first  # no duplicates

    def test_money_and_optional_defaults(self, db_session: Session) -> None:
        load_paystubs(db_session, SYNTHETIC_PAYSTUBS)
        db_session.flush()
        key = compute_dedupe_key(
            "Acme Co", date(2026, 1, 31), Decimal("5000.00"), Decimal("3500.00")
        )
        stub = db_session.scalar(select(Paystub).where(Paystub.dedupe_key == key))
        assert stub is not None
        assert stub.gross_pay == Decimal("5000.00")
        # Optional fields default to 0.00 when omitted.
        assert stub.reimbursements == Decimal("0.00")
        assert stub.retirement_401k_employee == Decimal("0.00")

    def test_accepts_dict_rows_from_extractor(self, db_session: Session) -> None:
        # scripts/extract_paystubs.py emits dict rows; the loader coerces them.
        row = {
            "employer": "Beta LLC",
            "period_start": date(2026, 2, 1),
            "period_end": date(2026, 2, 15),
            "pay_date": date(2026, 2, 15),
            "gross_pay": Decimal("4000.00"),
            "net_pay": Decimal("2900.00"),
            "taxes": Decimal("900.00"),
            "deductions": Decimal("200.00"),
            "retirement_401k_employee": Decimal("200.00"),
        }
        before = paystub_count(db_session)
        processed = load_paystubs(db_session, [row])
        db_session.flush()
        assert processed == 1
        assert paystub_count(db_session) == before + 1

    def test_empty_is_noop(self, db_session: Session) -> None:
        before = paystub_count(db_session)
        assert load_paystubs(db_session, []) == 0
        assert paystub_count(db_session) == before

    def test_accepts_attribute_object_rows(self, db_session: Session) -> None:
        # A plain object exposing attributes (not a dict) is coerced via getattr.
        class _Stub:
            employer = "Gamma Inc"
            period_start = date(2026, 3, 1)
            period_end = date(2026, 3, 15)
            pay_date = date(2026, 3, 15)
            gross_pay = Decimal("4200.00")
            net_pay = Decimal("3000.00")
            taxes = Decimal("1000.00")
            deductions = Decimal("200.00")

        before = paystub_count(db_session)
        processed = load_paystubs(db_session, [_Stub()])
        db_session.flush()
        assert processed == 1
        assert paystub_count(db_session) == before + 1


def test_to_row_missing_required_field_raises() -> None:
    from app.ingestion.income_loader import _to_row

    with pytest.raises(ValueError, match="missing required field"):
        _to_row(
            {
                "employer": "Acme Co",
                "period_start": date(2026, 1, 1),
                "period_end": date(2026, 1, 15),
                "pay_date": date(2026, 1, 15),
                # gross_pay missing
                "net_pay": Decimal("3500.00"),
                "taxes": Decimal("1200.00"),
                "deductions": Decimal("300.00"),
            }
        )
