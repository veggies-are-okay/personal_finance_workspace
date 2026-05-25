"""PDF-path tests for the app-side extractors + the ingest PDF branches (P8.1).

Constructing a real PDF is unnecessary: pdfplumber is mocked at the use-site to
return synthetic page text, exercising the Chase statement parser, the pay-stub
parser, and the router's PDF ingest branches. All text is SYNTHETIC (fabricated
merchants/amounts; data-privacy).
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
from app.ingestion import extract_chase, extract_paystubs
from app.main import app
from app.models import Paystub, Transaction

# A minimal synthetic Chase statement: the Opening/Closing line, a PURCHASE
# header, two purchase rows, and the summary total used for the invariant check.
SYNTHETIC_CHASE_TEXT = (
    "Opening/Closing Date 04/10/26 - 05/09/26\n"
    "Purchases +$45.34\n"
    "ACCOUNT ACTIVITY\n"
    "PURCHASE\n"
    "04/12 SYNTHETIC CAFE SF CA 45.09\n"
    "04/20 NAYAX VENDING .25\n"
    "FEES CHARGED\n"
)

# A minimal synthetic Rippling pay-stub SUMMARY block.
SYNTHETIC_PAYSTUB_TEXT = (
    "SUMMARY CURRENT YTD\n"
    "Gross Pay $5,000.00 $5,000.00\n"
    "Reimbursements $0.00 $0.00\n"
    "Deductions $300.00 $300.00\n"
    "Taxes $1,200.00 $1,200.00\n"
    "Employer Taxes $400.00 $400.00\n"
    "Net Pay $3,500.00 $3,500.00\n"
    "401K (Pre-tax) $250.00 $125.00 $250.00 $125.00\n"
)


@contextmanager
def _mock_pdfplumber(module, text: str) -> Iterator[None]:
    """Patch ``<module>.pdfplumber.open`` to yield one page with ``text``."""
    page = MagicMock()
    page.extract_text.return_value = text
    pdf = MagicMock()
    pdf.pages = [page]
    cm = MagicMock()
    cm.__enter__.return_value = pdf
    cm.__exit__.return_value = False
    with patch.object(module.pdfplumber, "open", return_value=cm):
        yield


@pytest.fixture
def db_session() -> Iterator[Session]:
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
    app.dependency_overrides[get_db] = lambda: db_session
    with patch("app.ingestion.router.run_precompute"):
        with TestClient(app) as test_client:
            yield test_client
    app.dependency_overrides.clear()


# --- app-side extractor parsing (mocked PDF) ---------------------------------


class TestChaseExtractor:
    def test_parse_statement_matches_summary(self) -> None:
        from pathlib import Path

        with _mock_pdfplumber(extract_chase, SYNTHETIC_CHASE_TEXT):
            txns, summary = extract_chase.parse_statement(Path("synthetic.pdf"))
        assert summary == Decimal("45.34")
        # Sum of parsed purchases equals the printed summary total (the invariant).
        assert sum((t.amount for t in txns), Decimal("0")) == summary
        # Sub-dollar amount parsed without a leading zero.
        assert any(t.amount == Decimal("0.25") for t in txns)

    def test_parse_lines_requires_open_close(self) -> None:
        with pytest.raises(ValueError, match="Opening/Closing"):
            extract_chase.parse_lines(["PURCHASE", "04/12 X 1.00"])


class TestPaystubExtractor:
    def test_parse_paystub_from_text(self) -> None:
        row = extract_paystubs.parse_paystub_text(
            SYNTHETIC_PAYSTUB_TEXT,
            source_file="paystub-acme-20260101-20260115-x.pdf",
            employer="acme",
            period_start=date(2026, 1, 1),
            period_end=date(2026, 1, 15),
        )
        assert row["gross_pay"] == Decimal("5000.00")
        assert row["net_pay"] == Decimal("3500.00")
        assert row["retirement_401k_employee"] == Decimal("250.00")


# --- router PDF ingest branches (mocked PDF) ---------------------------------


@pytest.mark.slow
class TestIngestPdf:
    def test_transactions_chase_pdf(self, client: TestClient, db_session: Session) -> None:
        before = db_session.scalar(select(Transaction).where(Transaction.dedupe_key == "x"))
        assert before is None
        with _mock_pdfplumber(extract_chase, SYNTHETIC_CHASE_TEXT):
            resp = client.post(
                "/api/v1/ingest/transactions",
                files=[("file", ("statement.pdf", b"%PDF-fake", "application/pdf"))],
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["files"][0]["detected_type"] == "chase_pdf"
        # 2 purchase rows detected and loaded.
        assert body["total_rows"] == 2

    def test_income_paystub_pdf(self, client: TestClient, db_session: Session) -> None:
        with _mock_pdfplumber(extract_paystubs, SYNTHETIC_PAYSTUB_TEXT):
            resp = client.post(
                "/api/v1/ingest/income",
                files=[
                    (
                        "file",
                        ("paystub-acme-20260101-20260115-x.pdf", b"%PDF-fake", "application/pdf"),
                    )
                ],
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["files"][0]["detected_type"] == "paystub_pdf"
        assert body["total_rows"] == 1
        stub = db_session.scalars(
            select(Paystub).where(Paystub.employer == "acme", Paystub.pay_date == date(2026, 1, 15))
        ).one()
        assert stub.gross_pay == Decimal("5000.00")

    def test_income_unrecognized_pdf_filename_returns_422(self, client: TestClient) -> None:
        with _mock_pdfplumber(extract_paystubs, SYNTHETIC_PAYSTUB_TEXT):
            resp = client.post(
                "/api/v1/ingest/income",
                files=[("file", ("not-a-paystub.pdf", b"%PDF-fake", "application/pdf"))],
            )
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "VALIDATION_ERROR"
