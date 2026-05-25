"""Tests for the accounts.yaml snapshot loader (P8.1).

Pure-parse tests need no DB; the snapshot integration tests run against the
live Postgres inside a rolled-back transaction. Fixtures are **synthetic**.
"""

from __future__ import annotations

from collections.abc import Iterator
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import engine
from app.ingestion.accounts_loader import (
    AccountRow,
    account_count,
    load_accounts,
    parse_accounts,
)
from app.models import Account

ACCOUNTS_YAML = """
cash:
  - name: "Checking"
    institution: "Synthetic Bank"
    type: "checking"
    balance: "1234.56"
  - name: "Savings"
    type: "hysa"
    balance: "5000.00"
investments:
  - name: "Brokerage"
    institution: "Synthetic Brokerage"
    type: "taxable_brokerage"
    balance: "9999.99"
loans:
  - name: "Ignore me"
    balance: "100.00"
goals:
  - name: "Ignore me too"
    target_amount: "1.00"
"""


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


class TestParseAccounts:
    def test_parses_cash_and_investments_only(self) -> None:
        rows = parse_accounts(ACCOUNTS_YAML)
        names = [r.name for r in rows]
        assert names == ["Checking", "Savings", "Brokerage"]  # loans/goals ignored

    def test_money_parsed_to_decimal(self) -> None:
        rows = {r.name: r for r in parse_accounts(ACCOUNTS_YAML)}
        assert rows["Checking"].balance == Decimal("1234.56")
        assert rows["Brokerage"].balance == Decimal("9999.99")

    def test_missing_institution_is_none(self) -> None:
        rows = {r.name: r for r in parse_accounts(ACCOUNTS_YAML)}
        assert rows["Savings"].institution is None
        assert rows["Checking"].institution == "Synthetic Bank"

    def test_empty_document_returns_empty(self) -> None:
        assert parse_accounts("") == []
        assert parse_accounts("not a mapping") == []

    def test_entry_without_name_skipped(self) -> None:
        rows = parse_accounts('cash:\n  - type: "checking"\n    balance: "1.00"\n')
        assert rows == []

    def test_missing_balance_is_none(self) -> None:
        rows = parse_accounts('cash:\n  - name: "NoBal"\n    type: "checking"\n')
        assert rows[0].balance is None


class TestLoadAccounts:
    def test_load_inserts_rows(self, db_session: Session) -> None:
        rows = parse_accounts(ACCOUNTS_YAML)
        count = load_accounts(db_session, rows)
        db_session.flush()
        assert count == 3
        loaded = {a.name: a for a in db_session.scalars(select(Account)).all()}
        assert loaded["Checking"].balance == Decimal("1234.56")
        assert loaded["Checking"].currency == "USD"

    def test_snapshot_replaces_prior_rows(self, db_session: Session) -> None:
        load_accounts(db_session, [AccountRow("Old", "checking", None, Decimal("1.00"))])
        db_session.flush()
        load_accounts(db_session, [AccountRow("New", "checking", None, Decimal("2.00"))])
        db_session.flush()
        names = [a.name for a in db_session.scalars(select(Account)).all()]
        assert names == ["New"]

    def test_empty_clears_table(self, db_session: Session) -> None:
        load_accounts(db_session, [AccountRow("X", "checking", None, None)])
        db_session.flush()
        assert load_accounts(db_session, []) == 0
        db_session.flush()
        assert account_count(db_session) == 0
