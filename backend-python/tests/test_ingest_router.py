"""Tests for the Python-only ingest endpoints (P8.1).

``POST /api/v1/ingest/{source}`` for transactions / income / holdings /
accounts / loans. Covers: a synthetic file -> rows in the DB, bank-CSV type
detection, the canonical 422 (no file / unknown source / unparseable) and 503
(DB down) envelopes, and the per-file summary shape.

All fixtures are SYNTHETIC (data-privacy). The DB-backed tests run against the
local docker-compose Postgres inside a transaction rolled back on teardown;
``run_precompute`` is patched out at the router use-site so the endpoint tests
stay focused and fast (the precompute pipeline has its own golden tests).
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
from app.errors import ServiceUnavailableError
from app.ingestion.holdings_loader import holding_count
from app.ingestion.loader import transaction_count
from app.ingestion.router import detect_csv_type
from app.main import app
from app.models import Account, Holding, Loan, Paystub

# --- synthetic upload bodies --------------------------------------------------

AMEX_CSV = (
    b"Date,Description,Amount\n04/01/2026,Synthetic Cafe,4.25\n04/02/2026,Synthetic Mart,10.00\n"
)
CHECKING_CSV = (
    b"Account Name,Synthetic Checking\nAccount Number,XXXX\nDate Range,2026\n"
    b"Transaction Number,Date,Description,Memo,Amount Debit,Amount Credit,Balance,Check Number\n"
    b"1,04/03/2026,Payroll,Payroll Deposit,,2500.00,2500.00,\n"
)
ELAN_CSV = b"Date,Transaction,Name,Memo,Amount\n2026-04-04,DEBIT,Synthetic Grocer,,-58.10\n"
ETRADE_CSV = (
    b"As of 01/01/2026,,,,,,,,,\n"
    b"Symbol,Last,Chg,Chg%,Qty,Paid,DayGain,Total Gain $,TG%,Value $\n"
    b"VTI,1,1,1,1,1,1,100.00,1,1000.00\n"
    b"TOTAL,,,,,,,,,1000.00\n"
)
ACCOUNTS_YAML = (
    b'cash:\n  - name: "Checking"\n    type: "checking"\n    balance: "100.00"\n'
    b'investments:\n  - name: "Brokerage"\n    type: "taxable_brokerage"\n    balance: "200.00"\n'
)
LOANS_CSV = b"name,balance,interest rate,minimum payment\nSynthetic Loan,1000.00,5.0,50.00\n"
PAYSTUBS_CSV = (
    b"employer,period_start,period_end,pay_date,gross_pay,net_pay,taxes,deductions,"
    b"reimbursements,retirement_401k_employee,retirement_401k_employer\n"
    b"Acme Co,2026-01-01,2026-01-15,2026-01-15,5000.00,3500.00,1200.00,300.00,0.00,250.00,125.00\n"
)


@pytest.fixture
def db_session() -> Iterator[Session]:
    """Postgres session wrapped in a transaction rolled back on teardown.

    The ingest route calls ``db.commit()``; with a nested (SAVEPOINT)
    transaction that commit is contained and the outer rollback discards
    everything, so no synthetic rows persist.
    """
    try:
        connection = SessionLocal().connection()
    except Exception as exc:  # pragma: no cover - only without a DB
        pytest.skip(f"Postgres not available: {exc}")
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
def client(db_session: Session) -> Iterator[TestClient]:
    """TestClient with ``get_db`` overridden to the transactional session.

    ``run_precompute`` is patched to a no-op so transaction/income ingests do
    not run the full pipeline during these endpoint-focused tests.
    """
    app.dependency_overrides[get_db] = lambda: db_session
    with patch("app.ingestion.router.run_precompute") as precompute:
        with TestClient(app) as test_client:
            test_client.precompute_mock = precompute  # type: ignore[attr-defined]
            yield test_client
    app.dependency_overrides.clear()


# --- bank-file detection (pure) ----------------------------------------------


class TestDetectCsvType:
    def test_amex(self) -> None:
        assert detect_csv_type("Date,Description,Amount\n04/01/2026,X,4.25\n") == "amex"

    def test_chase(self) -> None:
        header = "Date of Transaction,Merchant Name or Transaction Description,Amount\n"
        assert detect_csv_type(header) == "chase"

    def test_checking_metadata_then_header(self) -> None:
        assert detect_csv_type(CHECKING_CSV.decode()) == "checking"

    def test_elan(self) -> None:
        assert detect_csv_type("Date,Transaction,Name,Memo,Amount\n") == "elan"

    def test_unknown_returns_none(self) -> None:
        assert detect_csv_type("foo,bar,baz\n1,2,3\n") is None


# --- transactions source ------------------------------------------------------


@pytest.mark.slow
class TestIngestTransactions:
    def test_loads_rows_and_runs_precompute(self, client: TestClient, db_session: Session) -> None:
        before = transaction_count(db_session)
        resp = client.post(
            "/api/v1/ingest/transactions",
            files=[("file", ("amex.csv", AMEX_CSV, "text/csv"))],
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["source"] == "transactions"
        assert body["total_rows"] == 2
        assert body["files"][0]["detected_type"] == "amex"
        assert body["files"][0]["rows"] == 2
        assert transaction_count(db_session) == before + 2
        # precompute re-ran for both dashboard windows.
        assert client.precompute_mock.call_count == 2  # type: ignore[attr-defined]

    def test_multiple_mixed_files(self, client: TestClient, db_session: Session) -> None:
        resp = client.post(
            "/api/v1/ingest/transactions",
            files=[
                ("file", ("amex.csv", AMEX_CSV, "text/csv")),
                ("file", ("checking.csv", CHECKING_CSV, "text/csv")),
                ("file", ("elan.csv", ELAN_CSV, "text/csv")),
            ],
        )
        assert resp.status_code == 200
        body = resp.json()
        detected = {f["filename"]: f["detected_type"] for f in body["files"]}
        assert detected == {"amex.csv": "amex", "checking.csv": "checking", "elan.csv": "elan"}
        assert body["total_rows"] == 4

    def test_unparseable_csv_returns_422(self, client: TestClient) -> None:
        resp = client.post(
            "/api/v1/ingest/transactions",
            files=[("file", ("mystery.csv", b"a,b,c\n1,2,3\n", "text/csv"))],
        )
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_no_file_returns_422(self, client: TestClient) -> None:
        resp = client.post("/api/v1/ingest/transactions")
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


# --- income source ------------------------------------------------------------


@pytest.mark.slow
class TestIngestIncome:
    def test_paystubs_csv_loads(self, client: TestClient, db_session: Session) -> None:
        resp = client.post(
            "/api/v1/ingest/income",
            files=[("file", ("paystubs.csv", PAYSTUBS_CSV, "text/csv"))],
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["total_rows"] == 1
        assert body["files"][0]["detected_type"] == "paystubs_csv"
        # Income is an idempotent UPSERT (not snapshot-replace), so query by the
        # synthetic key rather than assuming an empty table.
        stub = db_session.scalars(
            select(Paystub).where(
                Paystub.employer == "Acme Co", Paystub.pay_date == date(2026, 1, 15)
            )
        ).one()
        assert stub.gross_pay == Decimal("5000.00")

    def test_unparseable_csv_returns_422(self, client: TestClient) -> None:
        resp = client.post(
            "/api/v1/ingest/income",
            files=[("file", ("nope.csv", b"x,y\n1,2\n", "text/csv"))],
        )
        assert resp.status_code == 422


# --- holdings / accounts / loans sources -------------------------------------


@pytest.mark.slow
class TestIngestSnapshots:
    def test_holdings(self, client: TestClient, db_session: Session) -> None:
        resp = client.post(
            "/api/v1/ingest/holdings",
            files=[("file", ("etrade.csv", ETRADE_CSV, "text/csv"))],
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["total_rows"] == 1
        assert body["files"][0]["detected_type"] == "etrade_csv"
        holding = db_session.scalars(select(Holding)).one()
        assert holding.symbol == "VTI"
        assert holding.value == Decimal("1000.00")
        assert holding.weight == Decimal("100.0")

    def test_accounts(self, client: TestClient, db_session: Session) -> None:
        resp = client.post(
            "/api/v1/ingest/accounts",
            files=[("file", ("accounts.yaml", ACCOUNTS_YAML, "application/x-yaml"))],
        )
        assert resp.status_code == 200
        assert resp.json()["total_rows"] == 2
        names = {a.name for a in db_session.scalars(select(Account)).all()}
        assert names == {"Checking", "Brokerage"}

    def test_loans(self, client: TestClient, db_session: Session) -> None:
        resp = client.post(
            "/api/v1/ingest/loans",
            files=[("file", ("loans.csv", LOANS_CSV, "text/csv"))],
        )
        assert resp.status_code == 200
        assert resp.json()["total_rows"] == 1
        loan = db_session.scalars(select(Loan)).one()
        assert loan.name == "Synthetic Loan"
        assert loan.priority == "minimums"

    def test_holdings_snapshot_replaces(self, client: TestClient, db_session: Session) -> None:
        # Pre-seed a holding, then ingest a new snapshot -> ALL prior rows gone.
        db_session.execute(
            insert(Holding),
            [
                {
                    "symbol": "OLD",
                    "name": "OLD",
                    "value": Decimal("1.00"),
                    "weight": Decimal("100.0"),
                    "gain": Decimal("0.00"),
                }
            ],
        )
        db_session.flush()
        client.post(
            "/api/v1/ingest/holdings",
            files=[("file", ("etrade.csv", ETRADE_CSV, "text/csv"))],
        )
        # Snapshot-replace truncates: only the freshly ingested rows remain.
        symbols = {h.symbol for h in db_session.scalars(select(Holding)).all()}
        assert symbols == {"VTI"}
        assert holding_count(db_session) == 1


# --- unknown source + DB-down -------------------------------------------------


class TestIngestErrors:
    def test_unknown_source_returns_422(self, client: TestClient) -> None:
        resp = client.post(
            "/api/v1/ingest/bogus",
            files=[("file", ("x.csv", AMEX_CSV, "text/csv"))],
        )
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_db_unavailable_returns_503(self, db_session: Session) -> None:
        # Override get_db with a session whose commit/flush raises a DB error.
        from sqlalchemy.exc import OperationalError

        def boom() -> Session:
            raise ServiceUnavailableError()

        # Use a session that errors on use by patching load_loans to raise the
        # canonical 503 path's trigger (an SQLAlchemyError).
        with patch(
            "app.ingestion.router.loans_loader.load_loans",
            side_effect=OperationalError("x", {}, Exception("down")),
        ):
            app.dependency_overrides[get_db] = lambda: db_session
            try:
                with TestClient(app) as c:
                    resp = c.post(
                        "/api/v1/ingest/loans",
                        files=[("file", ("loans.csv", LOANS_CSV, "text/csv"))],
                    )
            finally:
                app.dependency_overrides.clear()
        assert resp.status_code == 503
        assert resp.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
