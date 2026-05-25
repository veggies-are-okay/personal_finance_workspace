"""SQLAlchemy 2.0 ORM models — the **canonical** Postgres schema (P2.3).

Alembic owns migrations; these models are the metadata Alembic autogenerate
targets and the single source of truth that the ``backend-ts`` TypeORM entities
**mirror** (``synchronize:false``). A schema-parity check in ``contracts/``
asserts the two stay identical (tables + columns + types) — see DA-8.

Column-type conventions (Appendix A of ``plans/agent_checklist.md``):

* **Money** → ``NUMERIC(14, 2)`` (wire form is a decimal *string*; never float).
* **Percentages / ratios** → ``NUMERIC`` (a plain number 0-100 on the wire).
* **Datetimes** → ``TIMESTAMP(timezone=True)`` (``timestamptz``); dates → ``DATE``.
* **Enums** → ``TEXT`` + a ``CHECK`` constraint over the canonical enum registry
  (kept as text, not native PG enums, so both backends declare them identically).
* **Plaid ``access_token``** → ``BYTEA`` (encrypted ciphertext; encryption is
  P6.1 — here the column is just the binary type, never plaintext).

These are intentionally schema-only: no relationships/business logic. The view
endpoints (P4.*) and ingestion/precompute (P3.*) read/write these tables later.
"""

from __future__ import annotations

from sqlalchemy import (
    ARRAY,
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# --- Canonical enum registries (Appendix A). Kept here so the CHECK
# constraints and the parity check share one definition. -----------------
BUCKET_VALUES = ("needs", "wants", "savings")
SOURCE_VALUES = ("transactions", "income", "holdings", "loans", "listings")
SOURCE_MODE_VALUES = ("local", "api")
ITEM_STATUS_VALUES = (
    "connected",
    "needs_reauth",
    "error",
    "disconnected",
    "not_connected",
)
LOAN_PRIORITY_VALUES = ("pay_first", "then", "minimums")
PAYOFF_STRATEGY_VALUES = ("avalanche", "minimums")


def _enum_check(column: str, values: tuple[str, ...], name: str) -> CheckConstraint:
    """A named CHECK constraint pinning ``column`` to ``values`` (lower_snake)."""
    rendered = ", ".join(f"'{v}'" for v in values)
    return CheckConstraint(f"{column} IN ({rendered})", name=name)


# Reusable column type singletons (so every money/pct column is byte-identical).
MONEY = Numeric(14, 2)
PERCENT = Numeric()  # numeric, unscaled — a percentage 0-100, not money


class Account(Base):
    """A financial account (bank, credit card, brokerage, loan, …)."""

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    institution: Mapped[str | None] = mapped_column(Text, nullable=True)
    balance: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="USD")


class Transaction(Base):
    """A normalized ledger row + precomputed enrichment columns (P3.*)."""

    __tablename__ = "transactions"
    __table_args__ = (
        _enum_check("bucket", BUCKET_VALUES, "ck_transactions_bucket"),
        UniqueConstraint("dedupe_key", name="uq_transactions_dedupe_key"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    account_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    date: Mapped[object] = mapped_column(Date, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    # Idempotent re-import key (DA-19): hash(account, date, signed_amount, descr).
    dedupe_key: Mapped[str] = mapped_column(Text, nullable=False)
    # Precomputed enrichment (P3.2). Nullable until precompute runs.
    category: Mapped[str | None] = mapped_column(Text, nullable=True)
    bucket: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_transfer: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))
    is_recurring: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))


class Category(Base):
    """Categorization registry: maps a category name to a 50/30/20 bucket."""

    __tablename__ = "categories"
    __table_args__ = (_enum_check("bucket", BUCKET_VALUES, "ck_categories_bucket"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    bucket: Mapped[str] = mapped_column(Text, nullable=False)


class Budget(Base):
    """User-set budget target for a category/bucket."""

    __tablename__ = "budgets"
    __table_args__ = (_enum_check("bucket", BUCKET_VALUES, "ck_budgets_bucket"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    category: Mapped[str] = mapped_column(Text, nullable=False)
    bucket: Mapped[str] = mapped_column(Text, nullable=False)
    monthly_target: Mapped[object] = mapped_column(MONEY, nullable=False)


class Loan(Base):
    """A debt/loan tranche (Debt screen)."""

    __tablename__ = "loans"
    __table_args__ = (_enum_check("priority", LOAN_PRIORITY_VALUES, "ck_loans_priority"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    balance: Mapped[object] = mapped_column(MONEY, nullable=False)
    rate: Mapped[object] = mapped_column(PERCENT, nullable=False)
    minimum_payment: Mapped[object] = mapped_column(MONEY, nullable=False)
    priority: Mapped[str] = mapped_column(Text, nullable=False)


class Goal(Base):
    """A savings goal (Goals screen)."""

    __tablename__ = "goals"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    target: Mapped[object] = mapped_column(MONEY, nullable=False)
    saved: Mapped[object] = mapped_column(MONEY, nullable=False, server_default="0")
    progress_pct: Mapped[object | None] = mapped_column(PERCENT, nullable=True)


class Holding(Base):
    """An investment holding (Investments screen)."""

    __tablename__ = "holdings"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    value: Mapped[object] = mapped_column(MONEY, nullable=False)
    weight: Mapped[object] = mapped_column(PERCENT, nullable=False)
    gain: Mapped[object] = mapped_column(MONEY, nullable=False)
    asset_class: Mapped[str | None] = mapped_column(Text, nullable=True)


# --- Budget precompute (DA-23): columns cover EVERY field /api/v1/budget serves.
# Scalar rates live on budget_aggregates; the array fields (buckets/categories/
# monthly) are normalized child tables so each value's column type is explicit.


class BudgetAggregate(Base):
    """Top-level precomputed budget scalars for a window (savings/tax rate)."""

    __tablename__ = "budget_aggregates"
    __table_args__ = (UniqueConstraint("window", name="uq_budget_aggregates_window"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    window: Mapped[str] = mapped_column(Text, nullable=False)
    savings_rate: Mapped[object] = mapped_column(PERCENT, nullable=False)
    effective_tax_rate: Mapped[object] = mapped_column(PERCENT, nullable=False)


class BudgetBucketAggregate(Base):
    """Per-bucket precomputed target/actual/amount (``/budget.buckets[]``)."""

    __tablename__ = "budget_bucket_aggregates"
    __table_args__ = (_enum_check("name", BUCKET_VALUES, "ck_budget_bucket_aggregates_name"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    window: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    target_pct: Mapped[object] = mapped_column(PERCENT, nullable=False)
    actual_pct: Mapped[object] = mapped_column(PERCENT, nullable=False)
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)


class BudgetCategoryAggregate(Base):
    """Per-category precomputed amount + bucket (``/budget.categories[]``)."""

    __tablename__ = "budget_category_aggregates"
    __table_args__ = (_enum_check("bucket", BUCKET_VALUES, "ck_budget_category_aggregates_bucket"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    window: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    bucket: Mapped[str] = mapped_column(Text, nullable=False)


class BudgetMonthlyAggregate(Base):
    """Per-month precomputed needs/wants totals (``/budget.monthly[]``)."""

    __tablename__ = "budget_monthly_aggregates"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    window: Mapped[str] = mapped_column(Text, nullable=False)
    month: Mapped[str] = mapped_column(String(7), nullable=False)  # YYYY-MM
    needs: Mapped[object] = mapped_column(MONEY, nullable=False)
    wants: Mapped[object] = mapped_column(MONEY, nullable=False)


class RecurringCharge(Base):
    """A detected recurring charge (``/budget.recurring[]``)."""

    __tablename__ = "recurring_charges"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    merchant: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False)
    cadence: Mapped[str] = mapped_column(Text, nullable=False)
    last_charged: Mapped[object] = mapped_column(Date, nullable=False)
    monthly_est: Mapped[object] = mapped_column(MONEY, nullable=False)


class Paystub(Base):
    """One pay stub — the **income** source for precompute (P3.2).

    Mirrors the wide CSV ``scripts/extract_paystubs.py`` emits (the SUMMARY block
    + itemized 401(k)/taxes). Feeds savings-rate / effective-tax-rate precompute.
    All money columns are ``NUMERIC(14, 2)`` (Appendix A). Idempotent re-import
    upserts on the unique ``dedupe_key`` (``hash(employer, pay_date, gross_pay,
    net_pay)``) — mirrors the P3.1 loader's dedupe-on-key approach (DA-19).
    """

    __tablename__ = "paystubs"
    __table_args__ = (UniqueConstraint("dedupe_key", name="uq_paystubs_dedupe_key"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employer: Mapped[str] = mapped_column(Text, nullable=False)
    period_start: Mapped[object] = mapped_column(Date, nullable=False)
    period_end: Mapped[object] = mapped_column(Date, nullable=False)
    pay_date: Mapped[object] = mapped_column(Date, nullable=False)
    # Idempotent re-import key (DA-19): hash(employer, pay_date, gross_pay, net_pay).
    dedupe_key: Mapped[str] = mapped_column(Text, nullable=False)
    # SUMMARY block (per-period current amounts).
    gross_pay: Mapped[object] = mapped_column(MONEY, nullable=False)
    net_pay: Mapped[object] = mapped_column(MONEY, nullable=False)
    taxes: Mapped[object] = mapped_column(MONEY, nullable=False)
    deductions: Mapped[object] = mapped_column(MONEY, nullable=False)
    reimbursements: Mapped[object] = mapped_column(MONEY, nullable=False, server_default="0")
    # Itemized 401(k) employee/employer contributions (savings-rate inputs).
    retirement_401k_employee: Mapped[object] = mapped_column(
        MONEY, nullable=False, server_default="0"
    )
    retirement_401k_employer: Mapped[object] = mapped_column(
        MONEY, nullable=False, server_default="0"
    )


class PlaidItem(Base):
    """A linked Plaid Item (one login → multiple products).

    ``access_token`` is ``BYTEA`` ciphertext (AES-256-GCM, key from
    ``APP_ENCRYPTION_KEY``; encryption itself lands in P6.1). No plaintext token
    column ever exists. ``products`` is a text array.
    """

    __tablename__ = "plaid_items"
    __table_args__ = (
        _enum_check("status", ITEM_STATUS_VALUES, "ck_plaid_items_status"),
        UniqueConstraint("item_id", name="uq_plaid_items_item_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(Text, nullable=False)
    item_id: Mapped[str] = mapped_column(Text, nullable=False)
    access_token: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    institution: Mapped[str | None] = mapped_column(Text, nullable=True)
    products: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'connected'"))
    created_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class SourceConfig(Base):
    """Per-source mode (``local`` flat file vs ``api`` provider)."""

    __tablename__ = "source_config"
    __table_args__ = (
        _enum_check("source", SOURCE_VALUES, "ck_source_config_source"),
        _enum_check("mode", SOURCE_MODE_VALUES, "ck_source_config_mode"),
        UniqueConstraint("source", name="uq_source_config_source"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    mode: Mapped[str] = mapped_column(Text, nullable=False, server_default="local")
