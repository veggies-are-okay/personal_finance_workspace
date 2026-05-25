"""P2.3 initial schema and item store

Canonical initial schema for the personal-finance app (Alembic owns migrations;
the backend-ts TypeORM entities mirror this with ``synchronize:false``). Defines:
accounts, transactions (+ enrichment cols), categories, budgets, loans, goals,
holdings, the budget precompute tables (budget_aggregates +
budget_{bucket,category,monthly}_aggregates + recurring_charges — covering every
``/api/v1/budget`` field, DA-23), plaid_items (access_token BYTEA ciphertext,
DA-12), and source_config.

Type conventions (Appendix A): money ``NUMERIC(14,2)``, percentages ``NUMERIC``,
datetimes ``timestamptz``, enums TEXT + CHECK over the canonical registry, token
``BYTEA``.

Revision ID: f0bda61fcf45
Revises:
Create Date: 2026-05-24 16:49:22.065747

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f0bda61fcf45"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "accounts",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("institution", sa.Text(), nullable=True),
        sa.Column("balance", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("currency", sa.String(length=3), server_default="USD", nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "budget_aggregates",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("window", sa.Text(), nullable=False),
        sa.Column("savings_rate", sa.Numeric(), nullable=False),
        sa.Column("effective_tax_rate", sa.Numeric(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("window", name="uq_budget_aggregates_window"),
    )
    op.create_table(
        "budget_bucket_aggregates",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("window", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("target_pct", sa.Numeric(), nullable=False),
        sa.Column("actual_pct", sa.Numeric(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.CheckConstraint(
            "name IN ('needs', 'wants', 'savings')", name="ck_budget_bucket_aggregates_name"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "budget_category_aggregates",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("window", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("bucket", sa.Text(), nullable=False),
        sa.CheckConstraint(
            "bucket IN ('needs', 'wants', 'savings')", name="ck_budget_category_aggregates_bucket"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "budget_monthly_aggregates",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("window", sa.Text(), nullable=False),
        sa.Column("month", sa.String(length=7), nullable=False),
        sa.Column("needs", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("wants", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "budgets",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("bucket", sa.Text(), nullable=False),
        sa.Column("monthly_target", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.CheckConstraint("bucket IN ('needs', 'wants', 'savings')", name="ck_budgets_bucket"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "categories",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("bucket", sa.Text(), nullable=False),
        sa.CheckConstraint("bucket IN ('needs', 'wants', 'savings')", name="ck_categories_bucket"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "goals",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("target", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("saved", sa.Numeric(precision=14, scale=2), server_default="0", nullable=False),
        sa.Column("progress_pct", sa.Numeric(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "holdings",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("symbol", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("value", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("weight", sa.Numeric(), nullable=False),
        sa.Column("gain", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("asset_class", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "loans",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("balance", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("rate", sa.Numeric(), nullable=False),
        sa.Column("minimum_payment", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("priority", sa.Text(), nullable=False),
        sa.CheckConstraint(
            "priority IN ('pay_first', 'then', 'minimums')", name="ck_loans_priority"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "plaid_items",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("item_id", sa.Text(), nullable=False),
        sa.Column("access_token", sa.LargeBinary(), nullable=False),
        sa.Column("institution", sa.Text(), nullable=True),
        sa.Column("products", sa.ARRAY(sa.Text()), nullable=True),
        sa.Column("status", sa.Text(), server_default=sa.text("'connected'"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('connected', 'needs_reauth', 'error', 'disconnected', 'not_connected')",
            name="ck_plaid_items_status",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("item_id", name="uq_plaid_items_item_id"),
    )
    op.create_table(
        "recurring_charges",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("merchant", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("cadence", sa.Text(), nullable=False),
        sa.Column("last_charged", sa.Date(), nullable=False),
        sa.Column("monthly_est", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "source_config",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("mode", sa.Text(), server_default="local", nullable=False),
        sa.CheckConstraint("mode IN ('local', 'api')", name="ck_source_config_mode"),
        sa.CheckConstraint(
            "source IN ('transactions', 'income', 'holdings', 'loans', 'listings')",
            name="ck_source_config_source",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source", name="uq_source_config_source"),
    )
    op.create_table(
        "transactions",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("account_id", sa.BigInteger(), nullable=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("dedupe_key", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=True),
        sa.Column("bucket", sa.Text(), nullable=True),
        sa.Column("is_transfer", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("is_recurring", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.CheckConstraint(
            "bucket IN ('needs', 'wants', 'savings')", name="ck_transactions_bucket"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dedupe_key", name="uq_transactions_dedupe_key"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("transactions")
    op.drop_table("source_config")
    op.drop_table("recurring_charges")
    op.drop_table("plaid_items")
    op.drop_table("loans")
    op.drop_table("holdings")
    op.drop_table("goals")
    op.drop_table("categories")
    op.drop_table("budgets")
    op.drop_table("budget_monthly_aggregates")
    op.drop_table("budget_category_aggregates")
    op.drop_table("budget_bucket_aggregates")
    op.drop_table("budget_aggregates")
    op.drop_table("accounts")
