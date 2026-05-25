"""Unit tests for parse_paystubs_csv (P8.1 income ingest helper).

Pure parsing — no DB. Verifies the wide paystubs.csv is read into PaystubRow
records using only the columns the ``paystubs`` table needs, with malformed
rows skipped. Fixtures are SYNTHETIC.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.ingestion.income_loader import parse_paystubs_csv

GOOD_CSV = (
    "source_file,employer,period_start,period_end,pay_date,gross_pay,net_pay,taxes,"
    "deductions,reimbursements,retirement_401k_employee,retirement_401k_employer\n"
    "p1.pdf,Acme Co,2026-01-01,2026-01-15,2026-01-15,5000.00,3500.00,1200.00,300.00,0.00,250.00,125.00\n"
    "p2.pdf,Acme Co,2026-01-16,2026-01-31,2026-01-31,5200.00,3600.00,1250.00,350.00,75.00,260.00,130.00\n"
)


def test_parses_rows() -> None:
    rows = parse_paystubs_csv(GOOD_CSV)
    assert len(rows) == 2
    first = rows[0]
    assert first.employer == "Acme Co"
    assert first.period_start == date(2026, 1, 1)
    assert first.pay_date == date(2026, 1, 15)
    assert first.gross_pay == Decimal("5000.00")
    assert first.retirement_401k_employee == Decimal("250.00")


def test_currency_noise_tolerated() -> None:
    csv = (
        "employer,period_start,period_end,pay_date,gross_pay,net_pay,taxes,deductions\n"
        'Acme Co,2026-02-01,2026-02-15,2026-02-15,"$5,000.00","$3,500.00","1,200.00","300.00"\n'
    )
    rows = parse_paystubs_csv(csv)
    assert rows[0].gross_pay == Decimal("5000.00")
    assert rows[0].net_pay == Decimal("3500.00")
    # optional fields default to 0.00 when columns are absent
    assert rows[0].reimbursements == Decimal("0.00")


def test_missing_required_column_returns_empty() -> None:
    # No pay_date column -> header signature not met.
    csv = "employer,period_start,period_end,gross_pay\nAcme,2026-01-01,2026-01-15,5000.00\n"
    assert parse_paystubs_csv(csv) == []


def test_bad_date_row_skipped() -> None:
    csv = (
        "employer,period_start,period_end,pay_date,gross_pay,net_pay,taxes,deductions\n"
        "Acme,not-a-date,2026-01-15,2026-01-15,5000,3500,1200,300\n"
        "Acme,2026-01-01,2026-01-15,2026-01-15,5000,3500,1200,300\n"
    )
    rows = parse_paystubs_csv(csv)
    assert len(rows) == 1  # the bad-date row is skipped


def test_empty_document_returns_empty() -> None:
    assert parse_paystubs_csv("") == []
