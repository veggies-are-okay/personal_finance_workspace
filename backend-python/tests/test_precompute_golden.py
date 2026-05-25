"""Golden-fixture precompute test (P3.2 / DA-9).

A fixed synthetic ``transactions`` + ``paystubs`` fixture is loaded, precompute
is run, and the resulting aggregate rows are asserted to **exact** values. The
run is repeated to prove determinism (two runs → identical tables). Both
backends will later read these same tables verbatim, so pinning the values here
is the parity-critical guard against recompute drift.

Runs against the **live Postgres** inside a rolled-back transaction; all data is
synthetic (fabricated merchants/amounts/dates).
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import engine
from app.ingestion.income_loader import PaystubRow, load_paystubs
from app.ingestion.loader import LedgerRow, load_ledger
from app.models import (
    BudgetAggregate,
    BudgetBucketAggregate,
    BudgetCategoryAggregate,
    BudgetMonthlyAggregate,
    RecurringCharge,
    Transaction,
)
from app.precompute import run_precompute

WINDOW = "all"


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


# --- Synthetic fixture (fully fabricated) --------------------------------------
# Income: 2 stubs → gross 10000, net 7000, taxes 2400, employee 401k 500.
PAYSTUBS = [
    PaystubRow(
        employer="Acme Co",
        period_start=date(2026, 1, 1),
        period_end=date(2026, 1, 15),
        pay_date=date(2026, 1, 15),
        gross_pay=Decimal("5000.00"),
        net_pay=Decimal("3500.00"),
        taxes=Decimal("1200.00"),
        deductions=Decimal("300.00"),
        retirement_401k_employee=Decimal("250.00"),
        retirement_401k_employer=Decimal("125.00"),
    ),
    PaystubRow(
        employer="Acme Co",
        period_start=date(2026, 2, 1),
        period_end=date(2026, 2, 15),
        pay_date=date(2026, 2, 15),
        gross_pay=Decimal("5000.00"),
        net_pay=Decimal("3500.00"),
        taxes=Decimal("1200.00"),
        deductions=Decimal("300.00"),
        retirement_401k_employee=Decimal("250.00"),
        retirement_401k_employer=Decimal("125.00"),
    ),
]

# Spending: monthly Safeway (Groceries→needs ×3), monthly Netflix
# (Subscriptions→wants ×3), 2 one-off coffees (Dining→wants), a transfer to
# savings (excluded from needs/wants), and an inflow (Income, not spend).
LEDGER = [
    LedgerRow("checking", date(2026, 1, 5), "SAFEWAY STORE 12", Decimal("-100.00")),
    LedgerRow("checking", date(2026, 2, 5), "SAFEWAY STORE 12", Decimal("-100.00")),
    LedgerRow("checking", date(2026, 3, 5), "SAFEWAY STORE 12", Decimal("-100.00")),
    LedgerRow("amex", date(2026, 1, 3), "NETFLIX.COM", Decimal("-15.00")),
    LedgerRow("amex", date(2026, 2, 3), "NETFLIX.COM", Decimal("-15.00")),
    LedgerRow("amex", date(2026, 3, 3), "NETFLIX.COM", Decimal("-15.00")),
    LedgerRow("amex", date(2026, 1, 10), "Corner Coffee Shop", Decimal("-10.00")),
    LedgerRow("amex", date(2026, 2, 11), "Corner Coffee Shop", Decimal("-10.00")),
    LedgerRow("checking", date(2026, 1, 20), "Online Transfer to Savings", Decimal("-500.00")),
    LedgerRow("checking", date(2026, 1, 16), "Payroll Direct Deposit", Decimal("3500.00")),
]


def _seed(session: Session) -> None:
    load_ledger(session, LEDGER)
    load_paystubs(session, PAYSTUBS)
    session.flush()


def _bucket_rows(session: Session) -> dict[str, BudgetBucketAggregate]:
    rows = session.scalars(
        select(BudgetBucketAggregate).where(BudgetBucketAggregate.window == WINDOW)
    ).all()
    return {r.name: r for r in rows}


def _category_rows(session: Session) -> dict[str, BudgetCategoryAggregate]:
    rows = session.scalars(
        select(BudgetCategoryAggregate).where(BudgetCategoryAggregate.window == WINDOW)
    ).all()
    return {r.name: r for r in rows}


class TestGoldenPrecompute:
    def test_scalar_rates_exact(self, db_session: Session) -> None:
        _seed(db_session)
        result = run_precompute(db_session, window=WINDOW)
        db_session.flush()

        agg = db_session.scalar(select(BudgetAggregate).where(BudgetAggregate.window == WINDOW))
        assert agg is not None
        # effective tax = 2400/10000 = 24.0
        assert agg.effective_tax_rate == Decimal("24.0")
        # cash surplus = 7000 - 300 - 65 = 6635; savings num = 500 + 6635 = 7135
        # savings rate = 7135/10000 = 71.35 -> 71.4 (half-up, one dp)
        assert agg.savings_rate == Decimal("71.4")
        assert result.savings_rate == Decimal("71.4")

    def test_bucket_aggregates_exact(self, db_session: Session) -> None:
        _seed(db_session)
        run_precompute(db_session, window=WINDOW)
        db_session.flush()
        buckets = _bucket_rows(db_session)

        assert set(buckets) == {"needs", "wants", "savings"}
        # 50/30/20 canonical targets.
        assert buckets["needs"].target_pct == Decimal("50.0")
        assert buckets["wants"].target_pct == Decimal("30.0")
        assert buckets["savings"].target_pct == Decimal("20.0")
        # Amounts: needs=300 (groceries), wants=65 (45 subs + 20 dining),
        # savings=7135 (401k 500 + cash surplus 6635).
        assert buckets["needs"].amount == Decimal("300.00")
        assert buckets["wants"].amount == Decimal("65.00")
        assert buckets["savings"].amount == Decimal("7135.00")
        # actual_pct = share of net (7000): 300/7000=4.3, 65/7000=0.9.
        assert buckets["needs"].actual_pct == Decimal("4.3")
        assert buckets["wants"].actual_pct == Decimal("0.9")

    def test_category_aggregates_exact(self, db_session: Session) -> None:
        _seed(db_session)
        run_precompute(db_session, window=WINDOW)
        db_session.flush()
        cats = _category_rows(db_session)

        assert cats["Groceries"].amount == Decimal("300.00")
        assert cats["Groceries"].bucket == "needs"
        assert cats["Subscriptions"].amount == Decimal("45.00")
        assert cats["Subscriptions"].bucket == "wants"
        assert cats["Dining"].amount == Decimal("20.00")
        # Transfers / inflows are not spending categories.
        assert "Income" not in cats
        assert "Transfer" not in cats

    def test_monthly_aggregates_exact(self, db_session: Session) -> None:
        _seed(db_session)
        run_precompute(db_session, window=WINDOW)
        db_session.flush()
        rows = {
            r.month: r
            for r in db_session.scalars(
                select(BudgetMonthlyAggregate).where(BudgetMonthlyAggregate.window == WINDOW)
            ).all()
        }
        # Jan: groceries 100 needs; netflix 15 + coffee 10 = 25 wants.
        assert rows["2026-01"].needs == Decimal("100.00")
        assert rows["2026-01"].wants == Decimal("25.00")
        # Feb: groceries 100; netflix 15 + coffee 10 = 25.
        assert rows["2026-02"].needs == Decimal("100.00")
        assert rows["2026-02"].wants == Decimal("25.00")
        # Mar: groceries 100; netflix 15.
        assert rows["2026-03"].needs == Decimal("100.00")
        assert rows["2026-03"].wants == Decimal("15.00")

    def test_recurring_charges_exact(self, db_session: Session) -> None:
        _seed(db_session)
        run_precompute(db_session, window=WINDOW)
        db_session.flush()
        rows = sorted(
            db_session.scalars(select(RecurringCharge)).all(),
            key=lambda r: r.merchant,
        )
        # Groceries (Safeway ×3 monthly) + Subscriptions (Netflix ×3 monthly).
        merchants = [r.merchant for r in rows]
        assert merchants == ["Groceries", "Subscriptions"]
        for r in rows:
            assert r.cadence == "monthly"
            assert r.monthly_est > Decimal("0")

    def test_transactions_are_enriched(self, db_session: Session) -> None:
        _seed(db_session)
        run_precompute(db_session, window=WINDOW)
        db_session.flush()

        txns = db_session.scalars(select(Transaction)).all()
        by_desc = {t.description: t for t in txns}
        assert by_desc["SAFEWAY STORE 12"].category == "Groceries"
        assert by_desc["SAFEWAY STORE 12"].bucket == "needs"
        assert by_desc["SAFEWAY STORE 12"].is_recurring is True
        assert by_desc["Online Transfer to Savings"].is_transfer is True
        assert by_desc["Online Transfer to Savings"].bucket == "savings"
        # The single inflow is the Income category, not spending.
        assert by_desc["Payroll Direct Deposit"].category == "Income"
        assert by_desc["Corner Coffee Shop"].is_recurring is False

    def test_determinism_two_runs_identical(self, db_session: Session) -> None:
        _seed(db_session)
        first = _snapshot(db_session)
        second = _snapshot(db_session)
        assert first == second

    def test_rerun_does_not_duplicate_rows(self, db_session: Session) -> None:
        _seed(db_session)
        run_precompute(db_session, window=WINDOW)
        db_session.flush()
        n_buckets_1 = len(_bucket_rows(db_session))
        run_precompute(db_session, window=WINDOW)
        db_session.flush()
        n_buckets_2 = len(_bucket_rows(db_session))
        assert n_buckets_1 == n_buckets_2 == 3

    def test_spend_only_no_income_yields_zero_rates(self, db_session: Session) -> None:
        # Transactions but NO paystubs: gross/net are 0 -> rates are 0.0, the
        # cash-surplus clamp keeps the savings bucket non-negative.
        load_ledger(
            db_session,
            [LedgerRow("amex", date(2026, 1, 5), "SAFEWAY STORE 12", Decimal("-100.00"))],
        )
        db_session.flush()
        result = run_precompute(db_session, window=WINDOW)
        db_session.flush()

        assert result.savings_rate == Decimal("0.0")
        assert result.effective_tax_rate == Decimal("0.0")
        buckets = _bucket_rows(db_session)
        # No income → net is 0 → actual_pct is 0.0 (no division by zero).
        assert buckets["needs"].actual_pct == Decimal("0.0")
        assert buckets["needs"].amount == Decimal("100.00")
        assert buckets["savings"].amount == Decimal("0.00")


def _snapshot(session: Session) -> dict[str, object]:
    """Run precompute and capture the aggregate rows as comparable tuples."""
    run_precompute(session, window=WINDOW)
    session.flush()
    agg = session.scalar(select(BudgetAggregate).where(BudgetAggregate.window == WINDOW))
    buckets = sorted(
        (b.name, str(b.target_pct), str(b.actual_pct), str(b.amount))
        for b in session.scalars(
            select(BudgetBucketAggregate).where(BudgetBucketAggregate.window == WINDOW)
        ).all()
    )
    cats = sorted(
        (c.name, str(c.amount), c.bucket)
        for c in session.scalars(
            select(BudgetCategoryAggregate).where(BudgetCategoryAggregate.window == WINDOW)
        ).all()
    )
    monthly = sorted(
        (m.month, str(m.needs), str(m.wants))
        for m in session.scalars(
            select(BudgetMonthlyAggregate).where(BudgetMonthlyAggregate.window == WINDOW)
        ).all()
    )
    recurring = sorted(
        (r.merchant, r.category, r.cadence, r.last_charged.isoformat(), str(r.monthly_est))
        for r in session.scalars(select(RecurringCharge)).all()
    )
    return {
        "rates": (str(agg.savings_rate), str(agg.effective_tax_rate)),
        "buckets": buckets,
        "categories": cats,
        "monthly": monthly,
        "recurring": recurring,
    }
