"""Tests for the Chase statement purchase extractor.

The strongest invariant: for every statement, the sum of the purchases we
extract must equal the "Purchases +$..." figure Chase prints in the account
summary. This is checked against the real PDFs committed under
``docs/bank_statements/chase_pdf_statements``.
"""

from datetime import date
from decimal import Decimal

import pytest

import extract_chase_statements as ec

PDF_PATHS = sorted(ec.DEFAULT_PDF_DIR.glob("*.pdf"))


def test_pdfs_present():
    assert PDF_PATHS, f"No statement PDFs found under {ec.DEFAULT_PDF_DIR}"


@pytest.mark.parametrize("pdf_path", PDF_PATHS, ids=lambda p: p.name)
def test_extracted_purchases_match_summary(pdf_path):
    """Per-statement purchases sum to the account-summary purchases total."""
    txns, summary_total = ec.parse_statement(pdf_path)
    assert summary_total is not None, f"No summary purchases total in {pdf_path.name}"
    extracted = sum((t.amount for t in txns), Decimal("0"))
    assert extracted == summary_total, (
        f"{pdf_path.name}: extracted {extracted} != summary {summary_total}"
    )


@pytest.mark.parametrize("pdf_path", PDF_PATHS, ids=lambda p: p.name)
def test_transactions_are_well_formed(pdf_path):
    txns, _ = ec.parse_statement(pdf_path)
    assert txns, f"No purchases parsed from {pdf_path.name}"
    for t in txns:
        assert isinstance(t.date, date)
        assert t.description and t.description.strip() == t.description
        assert isinstance(t.amount, Decimal)
        # Continuation/exchange-rate lines must never leak into descriptions.
        assert "(EXCHG RATE)" not in t.description


def test_subdollar_amount_is_parsed():
    """Amounts printed without a leading zero (".15") are regression-prone."""
    txns, _ = ec.parse_statement(ec.DEFAULT_PDF_DIR / "20250809-statements-8144-.pdf")
    nayax = [t for t in txns if "NAYAX" in t.description and t.amount == Decimal("0.15")]
    assert nayax, "Expected the $.15 NAYAX purchase to be parsed"


def test_year_inference_across_cycle_boundary():
    """The Dec->Jan statement must date December rows to the prior year."""
    txns, _ = ec.parse_statement(ec.DEFAULT_PDF_DIR / "20260109-statements-8144-.pdf")
    years = {t.date.month: t.date.year for t in txns}
    if 12 in years:
        assert years[12] == 2025
    if 1 in years:
        assert years[1] == 2026


def test_extract_all_sorted_newest_first():
    txns = ec.extract_all()
    dates = [t.date for t in txns]
    assert dates == sorted(dates, reverse=True)


def test_write_csv_roundtrip(tmp_path):
    import csv

    txns = ec.extract_all()
    out = tmp_path / "out.csv"
    ec.write_csv(txns, out)

    with open(out, newline="") as f:
        rows = list(csv.reader(f))
    assert rows[0] == ec.CSV_HEADER
    assert len(rows) - 1 == len(txns)
    # Row order matches extraction order (newest first).
    assert rows[1][0] == txns[0].date.strftime("%m/%d/%Y")
    assert rows[1][2] == f"{txns[0].amount:.2f}"
