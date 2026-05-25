"""Snapshot loader: an E*TRADE positions CSV -> ``holdings`` (P8.1).

E*TRADE's portfolio export is a CSV with several preamble lines, then a
positions block introduced by a 10-column header row whose first cell is
``Symbol`` and which contains ``Value $`` / ``Total Gain $`` columns::

    Symbol, ..., Total Gain $, ..., Value $
    VTI,    ..., 1234.56,      ..., 9876.54
    ...
    (blank line / TOTAL row ends the block)

Column positions used (mirrors the working ``load_local.py`` orchestration):
``Symbol`` = col 0, ``Total Gain $`` = col 7, ``Value $`` = col 9.

Unlike the transaction/income loaders (idempotent upsert on a dedupe key), a
holdings snapshot is **replace-all**: a brokerage export is a point-in-time
position list, so each import truncates ``holdings`` and reloads the new
snapshot. ``weight`` is derived as each position's share of total value
(percent, one decimal — Appendix A DA-22). All money is ``Decimal``.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import Holding

_CENTS = Decimal("0.01")
_PCT_QUANT = Decimal("0.1")
_ZERO = Decimal("0")

# Cleaned of surrounding whitespace, quotes, thousands separators and a leading +.
_MONEY_STRIP = str.maketrans("", "", ' ",$')


@dataclass(frozen=True)
class HoldingRow:
    """One parsed brokerage position, ready to load."""

    symbol: str
    value: Decimal
    gain: Decimal


def _money(raw: str | None) -> Decimal:
    """Parse a money cell to ``Decimal``; blank / unparseable -> 0.00."""
    text = (raw or "").translate(_MONEY_STRIP).strip()
    if text.startswith("+"):
        text = text[1:]
    if not text or text in {"-", "+", "N/A", "--"}:
        return Decimal("0.00")
    try:
        return Decimal(text).quantize(_CENTS, rounding=ROUND_HALF_UP)
    except (ValueError, ArithmeticError):
        return Decimal("0.00")


def parse_holdings(text: str) -> list[HoldingRow]:
    """Parse the positions block out of an E*TRADE portfolio CSV.

    Locates the 10-column ``Symbol,...,Value $`` header, then reads each
    following row until a blank/short row (the ``TOTAL`` line or end of block).
    Rows whose symbol is empty or a ``TOTAL``/``CASH`` summary marker are
    skipped so only real tradable positions land.
    """
    reader = list(csv.reader(io.StringIO(text)))
    start: int | None = None
    for i, row in enumerate(reader):
        if row and row[0].strip() == "Symbol" and len(row) >= 10:
            start = i + 1
            break
    if start is None:
        return []

    out: list[HoldingRow] = []
    for row in reader[start:]:
        if not row or not row[0].strip():
            break
        symbol = row[0].strip()
        if symbol.upper() in {"TOTAL", "TOTALS", "CASH"}:
            continue
        value = _money(row[9] if len(row) > 9 else None)
        gain = _money(row[7] if len(row) > 7 else None)
        out.append(HoldingRow(symbol=symbol, value=value, gain=gain))
    return out


def load_holdings(session: Session, rows: list[HoldingRow]) -> int:
    """Replace ``holdings`` with ``rows`` (snapshot semantics). Returns the count.

    Truncates the existing snapshot first, then inserts each position with a
    derived ``weight`` (its share of total value, percent). The caller owns the
    transaction boundary (commit/rollback).
    """
    session.execute(delete(Holding))
    if not rows:
        return 0

    total = sum((r.value for r in rows), _ZERO)
    for r in rows:
        weight = (
            (r.value / total * Decimal("100")).quantize(_PCT_QUANT, rounding=ROUND_HALF_UP)
            if total > _ZERO
            else Decimal("0.0")
        )
        session.add(
            Holding(
                symbol=r.symbol,
                name=r.symbol,  # the export carries no display name; symbol stands in
                value=r.value,
                weight=weight,
                gain=r.gain,
                asset_class=None,
            )
        )
    return len(rows)


def holding_count(session: Session) -> int:
    """Total rows currently in ``holdings`` (helper for proofs/tests)."""
    return session.scalar(select(func.count()).select_from(Holding)) or 0
