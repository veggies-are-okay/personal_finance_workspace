"""Idempotent income loader: pay stubs → ``paystubs`` (P3.2).

The repo-root ``scripts/extract_paystubs.py`` parses each pay-stub PDF into a
wide row (SUMMARY block + itemized 401(k)/taxes). This module takes those rows
and **upserts** them into the Postgres ``paystubs`` table so that re-importing
the same income data never creates duplicate rows — mirroring the P3.1 ledger
loader's dedupe-on-key approach (DA-19).

Dedupe key (DA-19)
------------------
Pay stubs carry no stable IDs, so the idempotency key is a deterministic hash of
the natural key::

    dedupe_key = sha256(employer | pay_date | gross_pay | net_pay)

written to the unique ``paystubs.dedupe_key`` column. On conflict the loader
refreshes the mutable money fields in place — a re-import is an upsert.

Conventions
-----------
* **Money is ``Decimal``** and stored as ``NUMERIC(14, 2)``; every amount is
  quantized to 2 dp before hashing *and* writing, so trailing-zero noise never
  produces a second row (``5500`` and ``5500.00`` are the same stub).
"""

from __future__ import annotations

import csv
import hashlib
import io
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date as date_cls
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import Paystub

# Two-decimal quantum so money hashes/stores identically regardless of trailing
# zeros the source printed.
_CENTS = Decimal("0.01")

# The mutable money fields refreshed on a dedupe-key conflict (the natural-key
# fields that feed the hash are unchanged by definition).
_MONEY_FIELDS = (
    "gross_pay",
    "net_pay",
    "taxes",
    "deductions",
    "reimbursements",
    "retirement_401k_employee",
    "retirement_401k_employer",
)


@dataclass(frozen=True)
class PaystubRow:
    """One parsed pay stub, ready to load.

    Mirrors the fields ``scripts/extract_paystubs.py`` emits. Optional money
    fields default to ``0.00`` so first-of-year stubs (no reimbursements) and
    stubs without a 401(k) line load cleanly.
    """

    employer: str
    period_start: date_cls
    period_end: date_cls
    pay_date: date_cls
    gross_pay: Decimal
    net_pay: Decimal
    taxes: Decimal
    deductions: Decimal
    reimbursements: Decimal = field(default_factory=lambda: Decimal("0.00"))
    retirement_401k_employee: Decimal = field(default_factory=lambda: Decimal("0.00"))
    retirement_401k_employer: Decimal = field(default_factory=lambda: Decimal("0.00"))


def _quantize(amount: Decimal) -> Decimal:
    """Round money to 2 dp (half-up) so equal values hash/store identically."""
    return amount.quantize(_CENTS, rounding=ROUND_HALF_UP)


def compute_dedupe_key(
    employer: str, pay_date: date_cls, gross_pay: Decimal, net_pay: Decimal
) -> str:
    """Deterministic dedupe key — ``sha256`` of the natural key (DA-19).

    Components join with a NUL separator so distinct fields cannot collide by
    concatenation. Money is quantized to 2 dp first.
    """
    parts = (
        employer.strip(),
        pay_date.isoformat(),
        f"{_quantize(gross_pay):.2f}",
        f"{_quantize(net_pay):.2f}",
    )
    payload = "\x00".join(parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _to_row(entry: object) -> PaystubRow:
    """Coerce an input entry to a ``PaystubRow``.

    Accepts a ``PaystubRow`` directly, or any object/mapping exposing the same
    attributes (e.g. the dict ``scripts/extract_paystubs.py`` produces). Missing
    optional money fields default to ``0.00``.
    """
    if isinstance(entry, PaystubRow):
        return entry

    def _get(name: str) -> object:
        if isinstance(entry, dict):
            return entry.get(name)
        return getattr(entry, name, None)

    def _money(name: str, *, optional: bool = False) -> Decimal:
        value = _get(name)
        if value is None:
            if optional:
                return Decimal("0.00")
            raise ValueError(f"pay stub is missing required field: {name}")
        return Decimal(str(value))

    return PaystubRow(
        employer=str(_get("employer")),
        period_start=_get("period_start"),  # type: ignore[arg-type]
        period_end=_get("period_end"),  # type: ignore[arg-type]
        pay_date=_get("pay_date"),  # type: ignore[arg-type]
        gross_pay=_money("gross_pay"),
        net_pay=_money("net_pay"),
        taxes=_money("taxes"),
        deductions=_money("deductions"),
        reimbursements=_money("reimbursements", optional=True),
        retirement_401k_employee=_money("retirement_401k_employee", optional=True),
        retirement_401k_employer=_money("retirement_401k_employer", optional=True),
    )


def _dedupe_in_batch(rows: Iterable[PaystubRow]) -> dict[str, dict[str, object]]:
    """Map each row to its DB payload, keyed by dedupe_key (last write wins)."""
    mapped: dict[str, dict[str, object]] = {}
    for row in rows:
        gross = _quantize(row.gross_pay)
        net = _quantize(row.net_pay)
        key = compute_dedupe_key(row.employer, row.pay_date, gross, net)
        mapped[key] = {
            "employer": row.employer.strip(),
            "period_start": row.period_start,
            "period_end": row.period_end,
            "pay_date": row.pay_date,
            "dedupe_key": key,
            "gross_pay": gross,
            "net_pay": net,
            "taxes": _quantize(row.taxes),
            "deductions": _quantize(row.deductions),
            "reimbursements": _quantize(row.reimbursements),
            "retirement_401k_employee": _quantize(row.retirement_401k_employee),
            "retirement_401k_employer": _quantize(row.retirement_401k_employer),
        }
    return mapped


def load_paystubs(session: Session, entries: Sequence[object]) -> int:
    """Upsert pay-stub ``entries`` into ``paystubs`` (idempotent).

    Returns the number of distinct stubs processed (unique dedupe keys).
    Re-running with the same ``entries`` yields no new rows. The caller owns the
    transaction boundary (commit/rollback) so the loader stays composable.
    """
    payloads = _dedupe_in_batch(_to_row(e) for e in entries)
    if not payloads:
        return 0

    stmt = pg_insert(Paystub).values(list(payloads.values()))
    stmt = stmt.on_conflict_do_update(
        index_elements=[Paystub.dedupe_key],
        set_={col: stmt.excluded[col] for col in _MONEY_FIELDS},
    )
    session.execute(stmt)
    return len(payloads)


def paystub_count(session: Session) -> int:
    """Total rows currently in ``paystubs`` (helper for proofs/tests)."""
    return session.scalar(select(func.count()).select_from(Paystub)) or 0


# --- paystubs.csv parsing (P8.1 income ingest) --------------------------------
# The wide CSV that ``scripts/extract_paystubs.py`` emits carries far more
# columns than ``paystubs`` needs. This reads just the loader's required fields
# (mirrors load_local.py's parsing) so the /ingest/income endpoint can accept a
# pre-extracted paystubs.csv as well as raw PDFs.

_REQUIRED_CSV_COLUMNS = ("employer", "period_start", "period_end", "pay_date")


def _csv_money(raw: str | None) -> Decimal:
    """Parse a money cell from paystubs.csv; blank/unparseable -> 0.00."""
    text = (raw or "").replace(",", "").replace("$", "").strip()
    if not text:
        return Decimal("0.00")
    try:
        return Decimal(text)
    except (ValueError, ArithmeticError):
        return Decimal("0.00")


def parse_paystubs_csv(text: str) -> list[PaystubRow]:
    """Parse a ``paystubs.csv`` document into ``PaystubRow`` records.

    Reads only the columns the ``paystubs`` table needs (employer, the three
    dates, and the SUMMARY/401(k) money fields). Rows missing a required field
    or with an unparseable date are skipped so a partially-malformed export
    still loads the good rows. A document with no recognized header yields ``[]``.
    """
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or not all(c in reader.fieldnames for c in _REQUIRED_CSV_COLUMNS):
        return []

    rows: list[PaystubRow] = []
    for record in reader:
        try:
            rows.append(
                PaystubRow(
                    employer=(record.get("employer") or "").strip(),
                    period_start=date_cls.fromisoformat((record.get("period_start") or "").strip()),
                    period_end=date_cls.fromisoformat((record.get("period_end") or "").strip()),
                    pay_date=date_cls.fromisoformat((record.get("pay_date") or "").strip()),
                    gross_pay=_csv_money(record.get("gross_pay")),
                    net_pay=_csv_money(record.get("net_pay")),
                    taxes=_csv_money(record.get("taxes")),
                    deductions=_csv_money(record.get("deductions")),
                    reimbursements=_csv_money(record.get("reimbursements")),
                    retirement_401k_employee=_csv_money(record.get("retirement_401k_employee")),
                    retirement_401k_employer=_csv_money(record.get("retirement_401k_employer")),
                )
            )
        except ValueError:
            continue  # skip a malformed/blank row (bad date)
    return rows
