"""Snapshot loader: an ``accounts.yaml`` document -> ``accounts`` (P8.1).

The accounts YAML (see ``config/accounts.example.yaml``) groups entries under
top-level keys; the cash + investment accounts feed the Net Worth screen::

    cash:
      - name: "Checking"
        institution: "Example Bank"
        type: "checking"
        balance: "0.00"
    investments:
      - name: "401(k)"
        institution: "Example Provider"
        type: "401k"
        balance: "0.00"

(The ``loans`` and ``goals`` groups have their own dedicated loaders/tables and
are ignored here.) Each account row maps to one ``accounts`` row. Money is a
decimal **string** in the YAML and parsed to ``Decimal`` (Appendix A).

Like the holdings loader this is **replace-all** snapshot semantics: an
accounts file is the current balance sheet, so each import truncates
``accounts`` and reloads. The caller owns the transaction boundary.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

import yaml
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import Account

_CENTS = Decimal("0.01")

# YAML groups whose entries are balance-sheet accounts (vs loans/goals, which
# have their own loaders). Order is preserved for deterministic inserts.
_ACCOUNT_GROUPS = ("cash", "investments")


@dataclass(frozen=True)
class AccountRow:
    """One parsed account, ready to load."""

    name: str
    type: str
    institution: str | None
    balance: Decimal | None


def _money(raw: object) -> Decimal | None:
    """Parse a YAML money value (string or number) to ``Decimal``; None stays None."""
    if raw is None or raw == "":
        return None
    try:
        return Decimal(str(raw)).quantize(_CENTS, rounding=ROUND_HALF_UP)
    except (ValueError, ArithmeticError):
        return None


def parse_accounts(text: str) -> list[AccountRow]:
    """Parse the cash + investment accounts out of an ``accounts.yaml`` document.

    Tolerant of a missing group, a group with no entries, and entries missing a
    balance (stored as ``NULL``). An empty/invalid document yields ``[]``.
    """
    doc = yaml.safe_load(text) or {}
    if not isinstance(doc, dict):
        return []

    rows: list[AccountRow] = []
    for group in _ACCOUNT_GROUPS:
        for entry in doc.get(group) or []:
            if not isinstance(entry, dict):
                continue
            name = str(entry.get("name") or "").strip()
            if not name:
                continue
            rows.append(
                AccountRow(
                    name=name,
                    type=str(entry.get("type") or group).strip(),
                    institution=(
                        str(entry["institution"]).strip() if entry.get("institution") else None
                    ),
                    balance=_money(entry.get("balance")),
                )
            )
    return rows


def load_accounts(session: Session, rows: list[AccountRow]) -> int:
    """Replace ``accounts`` with ``rows`` (snapshot semantics). Returns the count."""
    session.execute(delete(Account))
    for r in rows:
        session.add(
            Account(
                name=r.name,
                type=r.type,
                institution=r.institution,
                balance=r.balance,
                currency="USD",
            )
        )
    return len(rows)


def account_count(session: Session) -> int:
    """Total rows currently in ``accounts`` (helper for proofs/tests)."""
    return session.scalar(select(func.count()).select_from(Account)) or 0
