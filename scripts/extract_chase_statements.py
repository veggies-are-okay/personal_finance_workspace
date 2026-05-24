"""Extract PURCHASE transactions from Chase credit-card PDF statements into a CSV.

The statements (``docs/bank_statements/chase_pdf_statements/*.pdf``) all share the
same quirky layout. Under the ``ACCOUNT ACTIVITY`` heading each statement lists
several sections; we only care about the one introduced by a ``PURCHASE`` header.
A purchase row looks like::

    07/10 PHILOMENAPIZZA.COM PHILOMENAPIZZ CA 45.09
    ^date ^merchant / description                ^USD amount

A few wrinkles the parser handles deterministically:

* The date is ``MM/DD`` with no year. The year is inferred from the statement's
  ``Opening/Closing Date`` so cycles that straddle a year boundary (Dec -> Jan)
  are dated correctly.
* Sub-dollar amounts are printed without a leading zero (``.15``).
* Foreign-currency purchases and airline tickets emit extra detail lines
  (``07/10 EURO`` / ``123.09 X 1.176618734 (EXCHG RATE)`` / ``070825 1 T YVR SFO``).
  These carry no USD amount and are dropped so each purchase is exactly one row.
* The PURCHASE section can spill onto the next page, repeating the page header /
  footer noise, which is filtered out.

Output schema: ``Date of Transaction, Merchant Name or Transaction Description, Amount``
ordered most-recent to oldest.

Run as a script::

    uv run python scripts/extract_chase_statements.py
    uv run python scripts/extract_chase_statements.py --pdf-dir <dir> --out <file.csv>
"""

from __future__ import annotations

import argparse
import csv
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path

import pdfplumber

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PDF_DIR = REPO_ROOT / "docs" / "bank_statements" / "chase_pdf_statements"
DEFAULT_OUT_CSV = REPO_ROOT / "docs" / "bank_statements" / "chase_credit_card.csv"

CSV_HEADER = ["Date of Transaction", "Merchant Name or Transaction Description", "Amount"]

# A purchase row: MM/DD  <description>  <amount>. The amount may lack a leading
# digit (".15") and may be negative (a refund); commas are thousands separators.
_TXN_RE = re.compile(r"^(\d{2})/(\d{2})\s+(.*\S)\s+(-?[\d,]*\.\d{2})$")
_OPEN_CLOSE_RE = re.compile(
    r"Opening/Closing Date\s+(\d{2})/(\d{2})/(\d{2})\s*-\s*(\d{2})/(\d{2})/(\d{2})"
)
# Account-summary line, used for validation: "Purchases +$1,647.08".
_SUMMARY_PURCHASES_RE = re.compile(r"Purchases\s+\+\$([\d,]+\.\d{2})")

# Section headers that terminate the PURCHASE block.
_STOP_PREFIXES = (
    "FEES CHARGED",
    "TOTAL",
    "INTEREST CHARGE",
    "INTEREST CHARGED",
    "PURCHASE INTEREST",
)
_YEAR_TOTALS_RE = re.compile(r"^\d{4}\s+Totals")
# Page header/footer noise that can appear mid-section when it spans pages.
_NOISE_SUBSTRINGS = (
    "Manage your account online",
    "Customer Service:",
    "www.chase",
    "Chase Mobile",
    "Download the",
    "Page ",
    "Statement Date:",
    "ACCOUNT ACTIVITY",
    "ACCOUNT MESSAGES",
    "YOUR ACCOUNT",
)


@dataclass(frozen=True)
class Transaction:
    date: date
    description: str
    amount: Decimal


def _infer_year(month: int, open_month: int, open_year: int, close_year: int) -> int:
    """Pick the calendar year for a MM/DD purchase within the billing cycle."""
    if open_year == close_year:
        return open_year
    # Cycle wraps a year boundary: months at/after the opening month belong to the
    # opening year, earlier months to the closing year.
    return open_year if month >= open_month else close_year


def _pdf_lines(path: Path) -> list[str]:
    lines: list[str] = []
    with pdfplumber.open(str(path)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            lines.extend(text.split("\n"))
    return lines


def _is_noise(line: str) -> bool:
    return any(sub in line for sub in _NOISE_SUBSTRINGS)


def parse_statement(path: Path) -> tuple[list[Transaction], Decimal | None]:
    """Parse one statement.

    Returns the list of purchase transactions and the account-summary purchases
    total (or ``None`` if it could not be found), which callers can use to
    validate the parse.
    """
    lines = _pdf_lines(path)
    full_text = "\n".join(lines)

    m = _OPEN_CLOSE_RE.search(full_text)
    if not m:
        raise ValueError(f"Could not find Opening/Closing Date in {path.name}")
    open_month, open_year = int(m.group(1)), 2000 + int(m.group(3))
    close_year = 2000 + int(m.group(6))

    sm = _SUMMARY_PURCHASES_RE.search(full_text)
    summary_total = Decimal(sm.group(1).replace(",", "")) if sm else None

    transactions: list[Transaction] = []
    in_purchase = False
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        if not in_purchase:
            if line == "PURCHASE":
                in_purchase = True
            continue
        # Inside the PURCHASE block.
        if line.startswith(_STOP_PREFIXES) or _YEAR_TOTALS_RE.match(line):
            break
        if _is_noise(line):
            continue
        tm = _TXN_RE.match(line)
        if not tm:
            # Foreign-currency / flight detail continuation line: no USD amount.
            continue
        month, day = int(tm.group(1)), int(tm.group(2))
        description = tm.group(3).strip()
        amount = Decimal(tm.group(4).replace(",", ""))
        year = _infer_year(month, open_month, open_year, close_year)
        transactions.append(Transaction(date(year, month, day), description, amount))

    return transactions, summary_total


def extract_all(pdf_dir: Path = DEFAULT_PDF_DIR) -> list[Transaction]:
    """Parse every statement in ``pdf_dir`` and return purchases, newest first."""
    transactions: list[Transaction] = []
    for path in sorted(pdf_dir.glob("*.pdf")):
        txns, _ = parse_statement(path)
        transactions.extend(txns)
    # Stable sort keeps a deterministic order for purchases sharing a date.
    transactions.sort(key=lambda t: t.date, reverse=True)
    return transactions


def write_csv(transactions: list[Transaction], out_path: Path = DEFAULT_OUT_CSV) -> None:
    with open(out_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(CSV_HEADER)
        for t in transactions:
            writer.writerow([t.date.strftime("%m/%d/%Y"), t.description, f"{t.amount:.2f}"])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pdf-dir", type=Path, default=DEFAULT_PDF_DIR, help="Directory of Chase statement PDFs."
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_CSV, help="Output CSV path.")
    args = parser.parse_args(argv)

    print(f"{'statement':<32}{'#txns':>7}{'extracted':>13}{'summary':>13}  check")
    grand_total = Decimal("0")
    count = 0
    for path in sorted(args.pdf_dir.glob("*.pdf")):
        txns, summary_total = parse_statement(path)
        extracted = sum((t.amount for t in txns), Decimal("0"))
        if summary_total is None:
            check = "n/a"
        elif extracted == summary_total:
            check = "OK"
        else:
            check = f"MISMATCH (Δ {extracted - summary_total:+.2f})"
        print(
            f"{path.name:<32}{len(txns):>7}{extracted:>13.2f}{(summary_total or 0):>13.2f}  {check}"
        )
        grand_total += extracted
        count += len(txns)

    transactions = extract_all(args.pdf_dir)
    write_csv(transactions, args.out)
    print(f"\nWrote {len(transactions)} transactions (total {grand_total:.2f}) to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
