"""Tests for the pay-stub extractor.

Per .claude/rules/testing_python.md these tests use only **synthetic** fixtures with
fictional amounts (never real pay data). The strong invariant exercised is the
pay-stub identity ``Net = Gross - Deductions - Taxes + Reimbursements`` (exact Decimal),
the same kind of printed-total cross-check the Chase extractor uses.
"""
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

import extract_paystubs as ep

FIXTURES = Path(__file__).parent / "fixtures"


def _parse(fixture_name: str, **kw) -> dict:
    text = (FIXTURES / fixture_name).read_text()
    defaults = dict(source_file=fixture_name, employer="ACME CORP",
                    period_start=date(2025, 1, 1), period_end=date(2025, 1, 15))
    defaults.update(kw)
    return ep.parse_paystub_text(text, **defaults)


def test_net_pay_identity_holds_for_both_label_styles():
    for fx in ("synthetic_paystub_legacy_labels.txt", "synthetic_paystub_2026_labels.txt"):
        row = _parse(fx)
        assert ep.net_pay_residual(row) == Decimal("0.00"), fx


def test_legacy_label_fields():
    row = _parse("synthetic_paystub_legacy_labels.txt")
    assert row["gross_pay"] == Decimal("6000.00")
    assert row["net_pay"] == Decimal("4050.00")
    assert row["reimbursements"] == Decimal("50.00")
    assert row["federal_income_tax"] == Decimal("700.00")
    assert row["federal_income_tax_ytd"] == Decimal("5600.00")
    # employee Medicare / Social Security, NOT the (different) employer figures
    assert row["medicare"] == Decimal("87.00")
    assert row["social_security"] == Decimal("372.00")
    assert row["ca_sdi"] == Decimal("60.00")
    assert row["ca_state_tax"] == Decimal("181.00")
    # 401(k): employee/employer, current/ytd
    assert row["retirement_401k_employee"] == Decimal("500.00")
    assert row["retirement_401k_employer"] == Decimal("100.00")
    assert row["retirement_401k_employee_ytd"] == Decimal("4000.00")
    assert row["medical_employee"] == Decimal("100.00")
    # earnings
    assert (row["salary"], row["salary_ytd"], row["salary_hours"]) == (
        Decimal("5000.00"), Decimal("40000.00"), Decimal("80.00"))
    # bonuses/retro lumped as other_earnings = gross - base salary
    assert row["other_earnings"] == Decimal("1000.00")
    assert row["other_earnings_ytd"] == Decimal("1000.00")


def test_2026_label_drift_and_absent_reimbursements():
    row = _parse("synthetic_paystub_2026_labels.txt")
    # "Medicare Tax" / "California SDI" / "California State Tax" still map correctly
    assert row["medicare"] == Decimal("79.75")
    assert row["ca_sdi"] == Decimal("66.00")
    assert row["ca_state_tax"] == Decimal("300.00")
    # no Reimbursements line on this stub -> treated as $0 (identity still holds)
    assert row["reimbursements"] == Decimal("0.00")
    # no bonus: gross == salary
    assert row["other_earnings"] == Decimal("0.00")


def test_pay_date_is_period_end():
    row = _parse("synthetic_paystub_legacy_labels.txt",
                 period_start=date(2025, 3, 1), period_end=date(2025, 3, 15))
    assert row["pay_date"] == "2025-03-15"
    assert row["period_start"] == "2025-03-01"


@pytest.mark.parametrize("filename,emp,d1,d2", [
    ("paystub-ACME-CORP-20250101-20250115-Jane Doe-emp-no-1.pdf", "ACME-CORP", "20250101", "20250115"),
    ("paystub-ACME-CORP-20251231-Jane Doe-emp-no-1.pdf", "ACME-CORP", "20251231", None),
])
def test_filename_date_parsing(filename, emp, d1, d2):
    m = ep._FNAME_RX.search(filename)
    assert m and m.group("emp") == emp
    assert m.group("d1") == d1 and m.group("d2") == d2


def test_write_csv_roundtrip(tmp_path):
    import csv

    rows = [_parse("synthetic_paystub_legacy_labels.txt"),
            _parse("synthetic_paystub_2026_labels.txt")]
    out = tmp_path / "paystubs.csv"
    ep.write_csv(rows, out)
    with open(out, newline="") as f:
        read = list(csv.reader(f))
    assert read[0] == ep.COLUMNS
    assert len(read) - 1 == len(rows)
    # Decimals render with 2 places; absent salary_hours is blank, never "None".
    assert "None" not in {cell for line in read[1:] for cell in line}
