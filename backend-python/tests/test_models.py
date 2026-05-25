"""Behavior tests for the canonical ORM schema (P2.3).

No live database is contacted — these assert the *declared* schema metadata
(column types, nullability, CHECK constraints, the BYTEA token, dedupe key) so
that the Alembic-owned schema and the parity check have a precise spec to hold
to. Column-type conventions are Appendix A of ``plans/agent_checklist.md``.
"""

from __future__ import annotations

from sqlalchemy import ARRAY, Date, DateTime, LargeBinary, Numeric, Text

from app import models
from app.db import Base

# All 14 tables P2.3 defines.
EXPECTED_TABLES = {
    "accounts",
    "transactions",
    "categories",
    "budgets",
    "loans",
    "goals",
    "holdings",
    "budget_aggregates",
    "budget_bucket_aggregates",
    "budget_category_aggregates",
    "budget_monthly_aggregates",
    "recurring_charges",
    "plaid_items",
    "source_config",
}


def test_all_tables_registered() -> None:
    assert EXPECTED_TABLES <= set(Base.metadata.tables)


def test_money_columns_are_numeric_14_2() -> None:
    # Representative money columns across tables.
    for table, col in [
        ("transactions", "amount"),
        ("loans", "balance"),
        ("loans", "minimum_payment"),
        ("goals", "target"),
        ("holdings", "value"),
        ("budget_monthly_aggregates", "needs"),
        ("recurring_charges", "monthly_est"),
    ]:
        coltype = Base.metadata.tables[table].columns[col].type
        assert isinstance(coltype, Numeric)
        assert coltype.precision == 14
        assert coltype.scale == 2, f"{table}.{col} should be NUMERIC(14,2)"


def test_percentage_columns_are_unscaled_numeric() -> None:
    # Percentages are bare NUMERIC (a number 0-100), distinct from money (DA-22).
    for table, col in [
        ("budget_aggregates", "savings_rate"),
        ("budget_aggregates", "effective_tax_rate"),
        ("loans", "rate"),
        ("holdings", "weight"),
        ("budget_bucket_aggregates", "target_pct"),
    ]:
        coltype = Base.metadata.tables[table].columns[col].type
        assert isinstance(coltype, Numeric)
        assert coltype.precision is None
        assert coltype.scale is None, f"{table}.{col} should be bare NUMERIC"


def test_access_token_is_bytea_and_no_plaintext_column() -> None:
    cols = Base.metadata.tables["plaid_items"].columns
    assert isinstance(cols["access_token"].type, LargeBinary)
    assert cols["access_token"].nullable is False
    # No plaintext token column may exist (DA-12).
    assert "access_token_plaintext" not in cols


def test_plaid_timestamps_are_timezone_aware() -> None:
    cols = Base.metadata.tables["plaid_items"].columns
    for name in ("created_at", "updated_at"):
        coltype = cols[name].type
        assert isinstance(coltype, DateTime)
        assert coltype.timezone is True, f"{name} must be timestamptz"


def test_products_is_text_array() -> None:
    coltype = Base.metadata.tables["plaid_items"].columns["products"].type
    assert isinstance(coltype, ARRAY)
    assert isinstance(coltype.item_type, Text)


def test_date_columns() -> None:
    assert isinstance(Base.metadata.tables["transactions"].columns["date"].type, Date)
    assert isinstance(Base.metadata.tables["recurring_charges"].columns["last_charged"].type, Date)


def test_transactions_dedupe_key_is_unique() -> None:
    # Idempotent re-import key (DA-19).
    table = Base.metadata.tables["transactions"]
    unique_cols = {
        tuple(c.name for c in con.columns)
        for con in table.constraints
        if con.__class__.__name__ == "UniqueConstraint"
    }
    assert ("dedupe_key",) in unique_cols


def test_enum_check_constraints_present() -> None:
    # Enums are TEXT + CHECK over the canonical registry.
    txn = Base.metadata.tables["transactions"]
    check_names = {
        con.name for con in txn.constraints if con.__class__.__name__ == "CheckConstraint"
    }
    assert "ck_transactions_bucket" in check_names

    loans = Base.metadata.tables["loans"]
    loan_checks = {
        con.name for con in loans.constraints if con.__class__.__name__ == "CheckConstraint"
    }
    assert "ck_loans_priority" in loan_checks


def test_enum_registries_match_appendix_a() -> None:
    assert models.BUCKET_VALUES == ("needs", "wants", "savings")
    assert models.SOURCE_MODE_VALUES == ("local", "api")
    assert models.ITEM_STATUS_VALUES == (
        "connected",
        "needs_reauth",
        "error",
        "disconnected",
        "not_connected",
    )
    assert models.PAYOFF_STRATEGY_VALUES == ("avalanche", "minimums")


def test_budget_aggregates_cover_every_budget_field() -> None:
    # DA-23: the precompute tables hold every field /api/v1/budget serves.
    assert {"savings_rate", "effective_tax_rate"} <= set(
        Base.metadata.tables["budget_aggregates"].columns.keys()
    )
    assert {"name", "target_pct", "actual_pct", "amount"} <= set(
        Base.metadata.tables["budget_bucket_aggregates"].columns.keys()
    )
    assert {"name", "amount", "bucket"} <= set(
        Base.metadata.tables["budget_category_aggregates"].columns.keys()
    )
    assert {"month", "needs", "wants"} <= set(
        Base.metadata.tables["budget_monthly_aggregates"].columns.keys()
    )
    assert {"merchant", "category", "cadence", "last_charged", "monthly_est"} <= set(
        Base.metadata.tables["recurring_charges"].columns.keys()
    )
