"""Normalize the per-source bank/credit statements into one canonical ledger.

**Canonical home** (P8.1): the pure CSV-normalization logic lives here under
``app/`` so the FastAPI ingest endpoints (and the Docker image, which copies
only ``app/``) can run it. The repo-root ``scripts/ledger.py`` is a thin CLI
wrapper that re-exports this module so the root project's tests stay green.

Raw statements arrive in incompatible formats and sign conventions. This module
maps each one onto a single signed-amount schema (see ``.claude/rules/api-data-pulls.md``):

> **NEGATIVE = money out (charge/debit/expense). POSITIVE = money in (payment/credit/deposit).**

Sources and their normalization (raw -> canonical):

* ``amex.csv``           ``Date,Description,Amount`` (``MM/DD/YYYY``); raw POSITIVE = charge.
                         Normalize ``amount = -raw`` (charges negative, payment credits positive).
* ``checking.csv``       3 metadata header lines, then
                         ``Transaction Number,Date,Description,Memo,Amount Debit,Amount Credit,...``
                         (``MM/DD/YYYY``); ``Amount Debit`` already negative, ``Amount Credit``
                         already positive. Normalize ``amount = debit if present else credit``.
* ``elan_credit_card.csv`` ``Date,Transaction,Name,Memo,Amount`` (``YYYY-MM-DD``); raw already
                         signed (DEBIT negative, CREDIT positive). Normalize ``amount = raw``.
* ``chase_credit_card.csv`` ``Date of Transaction,Merchant Name or Transaction Description,Amount``
                         (``MM/DD/YYYY``, produced by ``extract_chase``); raw
                         POSITIVE = purchase. Normalize ``amount = -raw``.

``load_ledger`` merges all four sources into one ledger sorted newest-first.
"""

from __future__ import annotations

import argparse
import csv
import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

# Repo root is four levels up: backend-python/app/ingestion/normalize_ledger.py.
REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DATA_DIR = REPO_ROOT / "docs" / "bank_statements"
DEFAULT_AMEX = DEFAULT_DATA_DIR / "amex.csv"
DEFAULT_CHECKING = DEFAULT_DATA_DIR / "checking.csv"
DEFAULT_ELAN = DEFAULT_DATA_DIR / "elan_credit_card.csv"
DEFAULT_CHASE = DEFAULT_DATA_DIR / "chase_credit_card.csv"
DEFAULT_OUT_CSV = DEFAULT_DATA_DIR / "ledger.csv"

CSV_HEADER = ["date", "source", "description", "amount"]

# An amount may have a leading sign, thousands separators, surrounding quotes /
# whitespace, and may omit the leading zero for sub-dollar values (".15").
_AMOUNT_CLEAN_RE = re.compile(r'[\s",]')


@dataclass(frozen=True)
class LedgerEntry:
    """One normalized transaction on the canonical signed-amount ledger."""

    date: date
    source: str
    description: str
    amount: Decimal


def parse_amount(raw: str) -> Decimal:
    """Parse a money string into a ``Decimal``.

    Handles thousands separators, surrounding quotes/whitespace, an optional
    leading ``+``/``-`` sign, and sub-dollar values printed without a leading
    zero (e.g. ``.15``).
    """
    cleaned = _AMOUNT_CLEAN_RE.sub("", raw)
    if not cleaned or cleaned in {"+", "-"}:
        raise ValueError(f"Cannot parse amount from {raw!r}")
    if cleaned.startswith("+"):
        cleaned = cleaned[1:]
    return Decimal(cleaned)


def _parse_date(raw: str, fmt: str) -> date:
    return datetime.strptime(raw.strip(), fmt).date()


def _is_repeated_header(row: dict[str, str], date_col: str) -> bool:
    """Detect a header row re-emitted mid-file.

    Some exports (e.g. Amex) split transactions into sections, each prefixed
    with another copy of the header line. ``csv.DictReader`` reads those as data
    rows where the date cell equals the column name; skip them.
    """
    return (row.get(date_col) or "").strip() == date_col


def normalize_amex(path: Path) -> list[LedgerEntry]:
    """Normalize ``amex.csv``: raw positive charge becomes negative money-out."""
    entries: list[LedgerEntry] = []
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            if _is_repeated_header(row, "Date"):
                continue
            entries.append(
                LedgerEntry(
                    date=_parse_date(row["Date"], "%m/%d/%Y"),
                    source="amex",
                    description=row["Description"].strip(),
                    amount=-parse_amount(row["Amount"]),
                )
            )
    return entries


def normalize_checking(path: Path) -> list[LedgerEntry]:
    """Normalize ``checking.csv``.

    Skips the 3 leading metadata lines, then reads the real header row. The raw
    ``Amount Debit`` is already negative and ``Amount Credit`` already positive,
    so the signed amount is whichever column is populated.
    """
    entries: list[LedgerEntry] = []
    with open(path, newline="") as f:
        lines = f.readlines()
    # Drop the 3 metadata lines (Account Name / Account Number / Date Range).
    reader = csv.DictReader(lines[3:])
    for row in reader:
        if _is_repeated_header(row, "Date"):
            continue
        debit = (row.get("Amount Debit") or "").strip()
        credit = (row.get("Amount Credit") or "").strip()
        amount = parse_amount(debit) if debit else parse_amount(credit)
        description = (row.get("Memo") or "").strip() or (row.get("Description") or "").strip()
        entries.append(
            LedgerEntry(
                date=_parse_date(row["Date"], "%m/%d/%Y"),
                source="checking",
                description=description,
                amount=amount,
            )
        )
    return entries


def normalize_elan(path: Path) -> list[LedgerEntry]:
    """Normalize ``elan_credit_card.csv``: raw amount is already correctly signed."""
    entries: list[LedgerEntry] = []
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            if _is_repeated_header(row, "Date"):
                continue
            name = (row.get("Name") or "").strip()
            memo = (row.get("Memo") or "").strip()
            description = name or memo
            entries.append(
                LedgerEntry(
                    date=_parse_date(row["Date"], "%Y-%m-%d"),
                    source="elan",
                    description=description,
                    amount=parse_amount(row["Amount"]),
                )
            )
    return entries


def normalize_chase(path: Path) -> list[LedgerEntry]:
    """Normalize ``chase_credit_card.csv``: raw positive purchase becomes negative."""
    entries: list[LedgerEntry] = []
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            if _is_repeated_header(row, "Date of Transaction"):
                continue
            entries.append(
                LedgerEntry(
                    date=_parse_date(row["Date of Transaction"], "%m/%d/%Y"),
                    source="chase",
                    description=row["Merchant Name or Transaction Description"].strip(),
                    amount=-parse_amount(row["Amount"]),
                )
            )
    return entries


def load_ledger(
    amex: Path | None = DEFAULT_AMEX,
    checking: Path | None = DEFAULT_CHECKING,
    elan: Path | None = DEFAULT_ELAN,
    chase: Path | None = DEFAULT_CHASE,
) -> list[LedgerEntry]:
    """Merge all available sources into one ledger sorted newest-first.

    Each path is optional: a ``None`` (or non-existent) source is skipped so the
    loader works with whatever subset of statements is present. Paths are
    parameters so callers (and tests) can point at fixtures.
    """
    entries: list[LedgerEntry] = []
    for path, normalize in (
        (amex, normalize_amex),
        (checking, normalize_checking),
        (elan, normalize_elan),
        (chase, normalize_chase),
    ):
        if path is None or not Path(path).exists():
            continue
        entries.extend(normalize(Path(path)))
    # Stable sort keeps a deterministic order for entries that share a date.
    entries.sort(key=lambda e: e.date, reverse=True)
    return entries


def write_csv(entries: list[LedgerEntry], out_path: Path = DEFAULT_OUT_CSV) -> None:
    with open(out_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(CSV_HEADER)
        for e in entries:
            writer.writerow([e.date.isoformat(), e.source, e.description, f"{e.amount:.2f}"])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--amex", type=Path, default=DEFAULT_AMEX)
    parser.add_argument("--checking", type=Path, default=DEFAULT_CHECKING)
    parser.add_argument("--elan", type=Path, default=DEFAULT_ELAN)
    parser.add_argument("--chase", type=Path, default=DEFAULT_CHASE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_CSV)
    args = parser.parse_args(argv)

    entries = load_ledger(amex=args.amex, checking=args.checking, elan=args.elan, chase=args.chase)
    counts: dict[str, int] = {}
    for e in entries:
        counts[e.source] = counts.get(e.source, 0) + 1
    write_csv(entries, args.out)
    summary = ", ".join(f"{src}={n}" for src, n in sorted(counts.items()))
    print(f"Wrote {len(entries)} ledger entries ({summary}) to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
