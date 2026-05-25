"""Snapshot loader: a flexible loan CSV -> ``loans`` (P8.1).

Loan/servicer exports vary widely in their column names, so this loader maps a
set of **common header variants** onto the canonical ``loans`` columns rather
than requiring one fixed schema:

* name        <- ``name`` | ``loan`` | ``servicer`` | ``lender`` | ``description``
* balance     <- ``balance`` | ``current balance`` | ``principal`` | ``amount``
* rate        <- ``rate`` | ``interest rate`` | ``apr`` | ``interest`` (percent, 0-100)
* min payment <- ``minimum payment`` | ``min payment`` | ``minimum`` | ``payment``

Header matching is case-insensitive and ignores surrounding whitespace and a
trailing ``%`` / ``$``. The ``priority`` column (payoff ordering) is not part of
a raw export, so it defaults to ``"minimums"`` (a valid ``loan_priority`` enum
value); the Debt screen's planner sets real priorities later.

Like the other snapshot loaders this is **replace-all**: each import truncates
``loans`` and reloads. All money is ``Decimal``; the caller owns the
transaction boundary.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import Loan

_CENTS = Decimal("0.01")
_ZERO = Decimal("0")
_DEFAULT_PRIORITY = "minimums"  # valid loan_priority enum value

# Canonical column -> accepted header variants (all lower_snake-normalized).
_NAME_KEYS = ("name", "loan", "loan_name", "servicer", "lender", "description")
_BALANCE_KEYS = ("balance", "current_balance", "principal", "amount", "outstanding")
_RATE_KEYS = ("rate", "interest_rate", "apr", "interest")
_MIN_KEYS = ("minimum_payment", "min_payment", "minimum", "payment", "monthly_payment")

_MONEY_STRIP = str.maketrans("", "", ' ",$%')


@dataclass(frozen=True)
class LoanRow:
    """One parsed loan, ready to load."""

    name: str
    balance: Decimal
    rate: Decimal
    minimum_payment: Decimal


def _norm_header(h: str) -> str:
    """Normalize a CSV header: lower-case, trim, spaces/dashes -> underscore."""
    return h.strip().lower().replace("-", " ").replace("  ", " ").strip().replace(" ", "_")


def _number(raw: str | None) -> Decimal:
    """Parse a money/rate cell to ``Decimal``; blank / unparseable -> 0."""
    text = (raw or "").translate(_MONEY_STRIP).strip()
    if text.startswith("+"):
        text = text[1:]
    if not text or text in {"-", "+", "N/A", "--"}:
        return _ZERO
    try:
        return Decimal(text)
    except (ValueError, ArithmeticError):
        return _ZERO


def _pick(row: dict[str, str], keys: tuple[str, ...]) -> str | None:
    """Return the first present value among ``keys`` (already-normalized headers)."""
    for key in keys:
        if key in row and (row[key] or "").strip():
            return row[key]
    return None


def parse_loans(text: str) -> list[LoanRow]:
    """Parse loans out of a flexible CSV, mapping common header variants.

    Rows with no recognizable name are skipped. Money is quantized to 2 dp; the
    rate is kept as a plain number (percent, 0-100). An empty document or one
    with no name column yields ``[]``.
    """
    reader = csv.reader(io.StringIO(text))
    try:
        raw_header = next(reader)
    except StopIteration:
        return []
    header = [_norm_header(h) for h in raw_header]

    rows: list[LoanRow] = []
    for raw_row in reader:
        if not any((c or "").strip() for c in raw_row):
            continue
        record = {header[i]: raw_row[i] for i in range(min(len(header), len(raw_row)))}
        name = _pick(record, _NAME_KEYS)
        if not name or not name.strip():
            continue
        rows.append(
            LoanRow(
                name=name.strip(),
                balance=_number(_pick(record, _BALANCE_KEYS)).quantize(
                    _CENTS, rounding=ROUND_HALF_UP
                ),
                rate=_number(_pick(record, _RATE_KEYS)),
                minimum_payment=_number(_pick(record, _MIN_KEYS)).quantize(
                    _CENTS, rounding=ROUND_HALF_UP
                ),
            )
        )
    return rows


def load_loans(session: Session, rows: list[LoanRow]) -> int:
    """Replace ``loans`` with ``rows`` (snapshot semantics). Returns the count."""
    session.execute(delete(Loan))
    for r in rows:
        session.add(
            Loan(
                name=r.name,
                balance=r.balance,
                rate=r.rate,
                minimum_payment=r.minimum_payment,
                priority=_DEFAULT_PRIORITY,
            )
        )
    return len(rows)


def loan_count(session: Session) -> int:
    """Total rows currently in ``loans`` (helper for proofs/tests)."""
    return session.scalar(select(func.count()).select_from(Loan)) or 0
