"""Idempotent loader: normalized ledger → ``transactions`` (P3.1).

The repo-root ``scripts/ledger.py`` normalizes each raw statement onto one
canonical **signed-amount** ledger (``NEGATIVE = money out``). This module takes
those normalized rows and **upserts** them into the Postgres ``transactions``
table so that re-importing the same ledger never creates duplicate rows.

Dedupe key (DA-19)
------------------
Statements carry no stable transaction IDs, so the idempotency key is a
deterministic hash of the normalized natural key::

    dedupe_key = sha256(account | date | signed_amount | normalized_description)

written to the unique ``transactions.dedupe_key`` column. On conflict the
loader updates the mutable fields (description/amount) in place — a re-import is
an upsert, not an insert.

Conventions
-----------
* **Money is ``Decimal``** and stored as ``NUMERIC(14, 2)``; the signed
  convention is preserved (negative = money out).
* The amount is **quantized to 2 dp** before hashing *and* writing, so the same
  logical transaction hashes identically regardless of trailing-zero noise
  (``-12.5`` and ``-12.50`` are the same row).
* The description is **normalized** (collapsed whitespace, upper-cased) for the
  hash only; the original description text is stored verbatim.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date as date_cls
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import Transaction

# Two-decimal quantum so money hashes/stores identically regardless of how many
# trailing zeros the source printed.
_CENTS = Decimal("0.01")
# Collapse any run of whitespace to a single space for the normalized hash input.
_WS_RE = re.compile(r"\s+")


@dataclass(frozen=True)
class LedgerRow:
    """One normalized signed-amount ledger row, ready to load.

    Mirrors the canonical fields produced by ``scripts/ledger.py`` (``date``,
    ``source``→``account``, ``description``, ``amount``). ``amount`` follows the
    signed convention: negative = money out.
    """

    account: str
    date: date_cls
    description: str
    amount: Decimal


def _quantize(amount: Decimal) -> Decimal:
    """Round money to 2 dp (half-up) so equal values hash/store identically."""
    return amount.quantize(_CENTS, rounding=ROUND_HALF_UP)


def normalize_description(description: str) -> str:
    """Normalize a description for hashing: trim, collapse whitespace, upper-case.

    Used only to build a *stable* dedupe key; the verbatim description is what
    gets stored. Two exports of the same charge that differ only in spacing or
    casing must still collapse to one ledger row.
    """
    return _WS_RE.sub(" ", description).strip().upper()


def compute_dedupe_key(
    account: str, when: date_cls, signed_amount: Decimal, description: str
) -> str:
    """Deterministic dedupe key — ``sha256`` of the normalized natural key (DA-19).

    Components are joined with a NUL separator so distinct fields cannot collide
    by concatenation (e.g. account ``"a"`` + descr ``"bc"`` vs ``"ab"`` + ``"c"``).
    """
    parts = (
        account.strip(),
        when.isoformat(),
        f"{_quantize(signed_amount):.2f}",
        normalize_description(description),
    )
    payload = "\x00".join(parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _to_row(entry: object) -> LedgerRow:
    """Coerce an input entry to a ``LedgerRow``.

    Accepts a ``LedgerRow`` directly, or any object exposing ``date``,
    ``description``, ``amount`` and an account identifier under either
    ``account`` or ``source`` (the field name ``scripts/ledger.py`` uses). This
    lets the loader consume ``scripts.ledger.LedgerEntry`` instances unchanged.
    """
    if isinstance(entry, LedgerRow):
        return entry
    account = getattr(entry, "account", None) or getattr(entry, "source", None)
    if account is None:
        raise ValueError("ledger entry is missing an account/source identifier")
    return LedgerRow(
        account=str(account),
        date=getattr(entry, "date"),
        description=str(getattr(entry, "description")),
        amount=Decimal(getattr(entry, "amount")),
    )


def _dedupe_in_batch(rows: Iterable[LedgerRow]) -> dict[str, dict[str, object]]:
    """Map each row to its DB payload, keyed by dedupe_key.

    Collisions *within a single batch* (the exact same transaction appearing
    twice in one ledger) are collapsed here, since Postgres ``ON CONFLICT``
    cannot act on two conflicting rows in the same statement. Last write wins.
    """
    mapped: dict[str, dict[str, object]] = {}
    for row in rows:
        amount = _quantize(row.amount)
        key = compute_dedupe_key(row.account, row.date, amount, row.description)
        mapped[key] = {
            "date": row.date,
            "description": row.description.strip(),
            "amount": amount,
            "dedupe_key": key,
        }
    return mapped


def load_ledger(session: Session, entries: Sequence[object]) -> int:
    """Upsert normalized ledger ``entries`` into ``transactions`` (idempotent).

    Returns the number of distinct ledger rows processed (unique dedupe keys).
    Re-running with the same ``entries`` yields no new rows: existing rows are
    updated in place on the unique ``dedupe_key`` conflict. The caller owns the
    transaction boundary (commit/rollback) so the loader stays composable.
    """
    payloads = _dedupe_in_batch(_to_row(e) for e in entries)
    if not payloads:
        return 0

    stmt = pg_insert(Transaction).values(list(payloads.values()))
    # On a dedupe_key conflict, refresh the mutable fields. The natural-key
    # fields (date/amount that feed the hash) are unchanged by definition, but
    # the verbatim description is re-asserted so a re-export overwrites cleanly.
    stmt = stmt.on_conflict_do_update(
        index_elements=[Transaction.dedupe_key],
        set_={
            "description": stmt.excluded.description,
            "amount": stmt.excluded.amount,
            "date": stmt.excluded.date,
        },
    )
    session.execute(stmt)
    return len(payloads)


def transaction_count(session: Session) -> int:
    """Total number of rows currently in ``transactions`` (helper for proofs/tests)."""
    return session.scalar(select(func.count()).select_from(Transaction)) or 0
