"""Integration tests for the idempotent ledger loader (P3.1).

These run against the **live Postgres** (the docker-compose / CI service
container) because the loader relies on Postgres ``INSERT ... ON CONFLICT`` for
its upsert. Each test runs inside a transaction that is **rolled back** on
teardown, so the suite leaves no rows behind and tests stay isolated.

All fixtures are **synthetic** — fabricated merchants, amounts, and dates. No
real financial data is used (``.claude/rules/data-privacy.md``).
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import engine
from app.ingestion.loader import (
    LedgerRow,
    compute_dedupe_key,
    load_ledger,
    normalize_description,
    transaction_count,
)
from app.models import Transaction


@pytest.fixture
def db_session() -> Iterator[Session]:
    """A session inside a rolled-back transaction (no rows persist).

    Requires the Postgres service to be reachable (docker compose up / CI
    service container). Skips cleanly if the DB is unavailable so the rest of
    the unit suite can still run locally without a database.
    """
    try:
        connection = engine.connect()
    except Exception as exc:  # pragma: no cover - exercised only without a DB
        pytest.skip(f"Postgres not available: {exc}")
    transaction = connection.begin()
    session = Session(bind=connection)
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


# --- Synthetic ledger fixtures (fictional merchants / amounts) -----------------

SYNTHETIC_LEDGER = [
    LedgerRow("amex", date(2026, 4, 1), "Fictional Coffee Co", Decimal("-4.25")),
    LedgerRow("checking", date(2026, 4, 2), "Payroll Deposit", Decimal("2500.00")),
    LedgerRow("elan", date(2026, 4, 3), "Imaginary Grocer", Decimal("-58.10")),
    LedgerRow("chase", date(2026, 4, 3), "Made-Up Streaming", Decimal("-12.99")),
]


def _count_with_key(session: Session, key: str) -> int:
    return session.scalar(
        select(func.count()).select_from(Transaction).where(Transaction.dedupe_key == key)
    )


class TestDedupeKey:
    """Pure-logic tests for the deterministic dedupe key (no DB)."""

    def test_key_is_deterministic(self) -> None:
        a = compute_dedupe_key("amex", date(2026, 4, 1), Decimal("-4.25"), "Coffee")
        b = compute_dedupe_key("amex", date(2026, 4, 1), Decimal("-4.25"), "Coffee")
        assert a == b

    def test_trailing_zero_amount_collapses(self) -> None:
        # -12.5 and -12.50 are the same logical money value -> same key.
        a = compute_dedupe_key("c", date(2026, 4, 3), Decimal("-12.5"), "X")
        b = compute_dedupe_key("c", date(2026, 4, 3), Decimal("-12.50"), "X")
        assert a == b

    def test_description_normalized_for_key(self) -> None:
        a = compute_dedupe_key("c", date(2026, 4, 3), Decimal("-1.00"), "Whole  Foods")
        b = compute_dedupe_key("c", date(2026, 4, 3), Decimal("-1.00"), " whole foods ")
        assert a == b

    def test_sign_matters(self) -> None:
        out = compute_dedupe_key("c", date(2026, 4, 3), Decimal("-5.00"), "X")
        inflow = compute_dedupe_key("c", date(2026, 4, 3), Decimal("5.00"), "X")
        assert out != inflow

    def test_account_separation_no_concat_collision(self) -> None:
        # NUL separator prevents ("ab","c") colliding with ("a","bc").
        a = compute_dedupe_key("ab", date(2026, 4, 3), Decimal("-1.00"), "c")
        b = compute_dedupe_key("a", date(2026, 4, 3), Decimal("-1.00"), "bc")
        assert a != b

    def test_normalize_description(self) -> None:
        assert normalize_description("  Whole   Foods\tMarket ") == "WHOLE FOODS MARKET"


class TestLoadLedger:
    """Integration: loading a synthetic ledger into Postgres is idempotent."""

    def test_load_inserts_rows(self, db_session: Session) -> None:
        before = transaction_count(db_session)
        processed = load_ledger(db_session, SYNTHETIC_LEDGER)
        db_session.flush()
        assert processed == len(SYNTHETIC_LEDGER)
        assert transaction_count(db_session) == before + len(SYNTHETIC_LEDGER)

    def test_double_load_is_idempotent(self, db_session: Session) -> None:
        before = transaction_count(db_session)
        first = load_ledger(db_session, SYNTHETIC_LEDGER)
        db_session.flush()
        after_first = transaction_count(db_session)
        second = load_ledger(db_session, SYNTHETIC_LEDGER)
        db_session.flush()
        after_second = transaction_count(db_session)

        assert first == len(SYNTHETIC_LEDGER)
        assert second == len(SYNTHETIC_LEDGER)  # same rows processed
        # No duplicates: count after the second load equals after the first.
        assert after_first == before + len(SYNTHETIC_LEDGER)
        assert after_second == after_first

    def test_fields_and_signs_map_correctly(self, db_session: Session) -> None:
        load_ledger(db_session, SYNTHETIC_LEDGER)
        db_session.flush()

        deposit_key = compute_dedupe_key(
            "checking", date(2026, 4, 2), Decimal("2500.00"), "Payroll Deposit"
        )
        deposit = db_session.scalar(
            select(Transaction).where(Transaction.dedupe_key == deposit_key)
        )
        assert deposit is not None
        assert deposit.amount == Decimal("2500.00")  # money in stays positive
        assert deposit.date == date(2026, 4, 2)
        assert deposit.description == "Payroll Deposit"

        charge_key = compute_dedupe_key(
            "amex", date(2026, 4, 1), Decimal("-4.25"), "Fictional Coffee Co"
        )
        charge = db_session.scalar(select(Transaction).where(Transaction.dedupe_key == charge_key))
        assert charge is not None
        assert charge.amount == Decimal("-4.25")  # money out stays negative

    def test_in_batch_duplicates_collapse(self, db_session: Session) -> None:
        # The same transaction twice in one ledger -> one row.
        dup = [
            LedgerRow("amex", date(2026, 4, 1), "Twice Charged", Decimal("-9.99")),
            LedgerRow("amex", date(2026, 4, 1), "Twice Charged", Decimal("-9.99")),
        ]
        before = transaction_count(db_session)
        processed = load_ledger(db_session, dup)
        db_session.flush()
        assert processed == 1
        assert transaction_count(db_session) == before + 1

    def test_reimport_updates_description_in_place(self, db_session: Session) -> None:
        # A re-export with the same natural key but tidied description upserts,
        # it does not duplicate.
        key = compute_dedupe_key("amex", date(2026, 4, 1), Decimal("-4.25"), "Fictional Coffee Co")
        load_ledger(db_session, SYNTHETIC_LEDGER)
        db_session.flush()
        # Same hash (description normalization is case/space-insensitive), new verbatim text.
        revised = [LedgerRow("amex", date(2026, 4, 1), "FICTIONAL COFFEE CO", Decimal("-4.25"))]
        load_ledger(db_session, revised)
        db_session.flush()

        assert _count_with_key(db_session, key) == 1
        row = db_session.scalar(select(Transaction).where(Transaction.dedupe_key == key))
        assert row is not None
        assert row.description == "FICTIONAL COFFEE CO"

    def test_empty_ledger_is_noop(self, db_session: Session) -> None:
        before = transaction_count(db_session)
        processed = load_ledger(db_session, [])
        assert processed == 0
        assert transaction_count(db_session) == before

    def test_accepts_scripts_ledger_entry_via_source_field(self, db_session: Session) -> None:
        # scripts.ledger.LedgerEntry exposes `source` (not `account`); the loader
        # coerces it. Use a duck-typed stand-in to avoid a cross-project import.
        class _Entry:
            def __init__(self) -> None:
                self.date = date(2026, 4, 9)
                self.source = "amex"
                self.description = "Source Field Merchant"
                self.amount = Decimal("-3.50")

        before = transaction_count(db_session)
        processed = load_ledger(db_session, [_Entry()])
        db_session.flush()
        assert processed == 1
        key = compute_dedupe_key(
            "amex", date(2026, 4, 9), Decimal("-3.50"), "Source Field Merchant"
        )
        assert _count_with_key(db_session, key) == 1
        assert transaction_count(db_session) == before + 1


def test_to_row_missing_account_raises() -> None:
    from app.ingestion.loader import _to_row

    class _NoAccount:
        date = date(2026, 4, 1)
        description = "X"
        amount = Decimal("-1.00")

    with pytest.raises(ValueError, match="account/source"):
        _to_row(_NoAccount())
