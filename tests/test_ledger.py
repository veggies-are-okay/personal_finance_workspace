"""Tests for the multi-source ledger normalizers and combined loader.

These exercise the canonical signed-amount convention
(**negative = money out, positive = money in**) against small SYNTHETIC
fixtures committed under ``tests/fixtures/``. No real financial data appears
here. Money is compared exactly as ``Decimal``.
"""

from datetime import date
from decimal import Decimal

import pytest

import ledger

FIXTURES = ledger.REPO_ROOT / "tests" / "fixtures"
AMEX = FIXTURES / "amex.csv"
AMEX_REPEATED_HEADER = FIXTURES / "amex_repeated_header.csv"
CHECKING = FIXTURES / "checking.csv"
ELAN = FIXTURES / "elan_credit_card.csv"
CHASE = FIXTURES / "chase_credit_card.csv"


# --------------------------------------------------------------------------- #
# parse_amount helper
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "raw,expected",
    [
        ("45.09", Decimal("45.09")),
        (".15", Decimal("0.15")),
        ("-12.00", Decimal("-12.00")),
        ("1,234.56", Decimal("1234.56")),
        ("  7.89  ", Decimal("7.89")),
        ('"1,000.00"', Decimal("1000.00")),
        ("+3.00", Decimal("3.00")),
    ],
)
def test_parse_amount(raw, expected):
    assert ledger.parse_amount(raw) == expected


# --------------------------------------------------------------------------- #
# amex: raw positive charge -> negative; raw negative payment -> positive
# --------------------------------------------------------------------------- #
def test_normalize_amex_signs_and_fields():
    entries = ledger.normalize_amex(AMEX)
    assert len(entries) == 4
    assert all(e.source == "amex" for e in entries)

    by_desc = {e.description: e for e in entries}
    # Charges become negative (money out).
    assert by_desc["SYNTHETIC COFFEE SHOP"].amount == Decimal("-12.50")
    assert by_desc["SYNTHETIC GROCERY MART"].amount == Decimal("-1234.56")
    # Sub-dollar charge without a leading zero.
    assert by_desc["SYNTHETIC TINY CHARGE"].amount == Decimal("-0.15")
    # A negative raw (payment credit) becomes positive (money in).
    assert by_desc["AUTOPAY PAYMENT THANK YOU"].amount == Decimal("500.00")

    coffee = by_desc["SYNTHETIC COFFEE SHOP"]
    assert coffee.date == date(2026, 1, 15)


def test_normalize_amex_skips_repeated_header_lines():
    """Real Amex exports can repeat the header mid-file when split into sections."""
    entries = ledger.normalize_amex(AMEX_REPEATED_HEADER)
    # The repeated "Date,Description,Amount" line must be dropped, not parsed.
    assert len(entries) == 4
    assert all(e.source == "amex" for e in entries)
    assert all(isinstance(e.date, date) for e in entries)


# --------------------------------------------------------------------------- #
# checking: skip 3 metadata lines; debit already negative, credit positive
# --------------------------------------------------------------------------- #
def test_normalize_checking_signs_and_metadata_skip():
    entries = ledger.normalize_checking(CHECKING)
    # 4 data rows after the 3 metadata lines + header.
    assert len(entries) == 4
    assert all(e.source == "checking" for e in entries)

    amounts = {e.description: e.amount for e in entries}
    # Credit stays positive (money in).
    assert amounts["SYNTHETIC PAYROLL DIRECT DEP"] == Decimal("2500.00")
    # Debit stays negative (money out).
    assert amounts["SYNTHETIC RENT PAYMENT"] == Decimal("-1200.00")
    # Sub-dollar / odd debit.
    assert amounts["SYNTHETIC CASH DEPOSIT"] == Decimal("1000.00")

    by_amount = {e.amount: e for e in entries}
    deposit = by_amount[Decimal("2500.00")]
    assert deposit.date == date(2026, 2, 10)


def test_normalize_checking_falls_back_to_description_when_memo_blank():
    entries = ledger.normalize_checking(CHECKING)
    # The row with an empty Memo (-7.89) must still get a non-empty description.
    small = [e for e in entries if e.amount == Decimal("-7.89")]
    assert len(small) == 1
    assert small[0].description.strip()


# --------------------------------------------------------------------------- #
# elan: amount already signed (DEBIT negative, CREDIT positive) -> as-is
# --------------------------------------------------------------------------- #
def test_normalize_elan_signs_and_fields():
    entries = ledger.normalize_elan(ELAN)
    assert len(entries) == 3
    assert all(e.source == "elan" for e in entries)

    by_desc = {e.description: e for e in entries}
    assert by_desc["SYNTHETIC HARDWARE STORE"].amount == Decimal("-45.67")
    assert by_desc["SYNTHETIC STATEMENT CREDIT"].amount == Decimal("30.00")
    # Sub-dollar debit stays negative.
    assert by_desc["SYNTHETIC PARKING"].amount == Decimal("-0.25")

    hardware = by_desc["SYNTHETIC HARDWARE STORE"]
    assert hardware.date == date(2026, 1, 5)


# --------------------------------------------------------------------------- #
# chase: raw positive purchase -> negative; raw negative refund -> positive
# --------------------------------------------------------------------------- #
def test_normalize_chase_signs_and_fields():
    entries = ledger.normalize_chase(CHASE)
    assert len(entries) == 3
    assert all(e.source == "chase" for e in entries)

    by_desc = {e.description: e for e in entries}
    assert by_desc["SYNTHETIC BOOKSTORE"].amount == Decimal("-42.00")
    assert by_desc["SYNTHETIC PIZZA PLACE"].amount == Decimal("-8.75")
    # A negative raw (refund) becomes positive (money in).
    assert by_desc["SYNTHETIC REFUND CREDIT"].amount == Decimal("15.00")

    book = by_desc["SYNTHETIC BOOKSTORE"]
    assert book.date == date(2026, 1, 30)


# --------------------------------------------------------------------------- #
# combined loader
# --------------------------------------------------------------------------- #
def test_load_ledger_merges_all_sources_sorted_newest_first():
    entries = ledger.load_ledger(amex=AMEX, checking=CHECKING, elan=ELAN, chase=CHASE)
    # 4 amex + 4 checking + 3 elan + 3 chase
    assert len(entries) == 14

    sources = {e.source for e in entries}
    assert sources == {"amex", "checking", "elan", "chase"}

    dates = [e.date for e in entries]
    assert dates == sorted(dates, reverse=True)


def test_load_ledger_tags_each_source_with_expected_count():
    entries = ledger.load_ledger(amex=AMEX, checking=CHECKING, elan=ELAN, chase=CHASE)
    counts = {}
    for e in entries:
        counts[e.source] = counts.get(e.source, 0) + 1
    assert counts == {"amex": 4, "checking": 4, "elan": 3, "chase": 3}


def test_load_ledger_skips_missing_sources():
    # Only amex provided; the rest default to None and are skipped.
    entries = ledger.load_ledger(amex=AMEX, checking=None, elan=None, chase=None)
    assert len(entries) == 4
    assert {e.source for e in entries} == {"amex"}


def test_ledger_entry_is_frozen():
    entry = ledger.LedgerEntry(
        date=date(2026, 1, 1), source="amex", description="x", amount=Decimal("1.00")
    )
    with pytest.raises(Exception):
        entry.amount = Decimal("2.00")  # type: ignore[misc]


def test_all_amounts_are_decimal():
    entries = ledger.load_ledger(amex=AMEX, checking=CHECKING, elan=ELAN, chase=CHASE)
    assert all(isinstance(e.amount, Decimal) for e in entries)
    assert all(isinstance(e.date, date) for e in entries)
