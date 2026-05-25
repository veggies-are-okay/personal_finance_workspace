"""``GET /api/v1/networth`` — the Net Worth view (P4.3).

A thin read that composes the ``accounts`` table into the design §3 shape — NO
recompute, NO synthesized history (DA-23 spirit). Both backends read the SAME
``accounts`` rows, so for the same DB state FastAPI and NestJS return
byte-identical bodies (DA-9):

* ``net_worth``   = sum of ALL account balances (= ``assets`` - ``liabilities``);
* ``assets``      = sum of POSITIVE balances;
* ``liabilities`` = absolute sum of NEGATIVE balances (money-out convention);
* ``accounts[]``  = one row per account (sorted by name, then id) with its
  current ``balance`` and a ``delta_30d`` of ``"0.00"`` (the snapshot table holds
  no balance history, so there is no 30-day change yet — a clock-derived value
  would break parity);
* ``series[]``    = EMPTY: the monthly retirement/investments/cash history needs
  a history source that the ``accounts`` snapshot table does not provide, and
  neither backend fabricates one.

A null account balance counts as 0. An empty DB yields all-zero totals and empty
arrays. A DB connectivity failure becomes a canonical 503 via
:class:`~app.errors.ServiceUnavailableError` (DA-18), exactly as the other view
routers do.

Money is serialized as a decimal **string** (Appendix A).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import ServiceUnavailableError
from app.models import Account
from app.schemas import NetWorth, NetWorthAccount

router = APIRouter(prefix="/api/v1", tags=["view"])

DEFAULT_WINDOW = "12m"

# No balance history yet -> every account's 30-day delta is a well-formed zero.
_ZERO = Decimal("0")


def build_networth(db: Session, _window: str) -> NetWorth:
    """Compose the ``accounts`` rows into the net-worth response.

    Deterministic ordering (accounts by name, then id) so both backends serialize
    identically. ``_window`` is accepted for contract parity with the other view
    endpoints but does not change the snapshot totals (there is no history to
    window over). Any DB failure is mapped to a canonical 503 (DA-18).
    """
    try:
        rows = db.execute(
            select(
                Account.id,
                Account.name,
                Account.type,
                Account.balance,
            ).order_by(Account.name.asc(), Account.id.asc())
        ).all()
    except SQLAlchemyError as exc:  # DB down / table missing / connection refused
        raise ServiceUnavailableError() from exc

    assets = _ZERO
    liabilities = _ZERO
    accounts: list[NetWorthAccount] = []
    for row in rows:
        balance = row.balance if row.balance is not None else _ZERO
        if balance > _ZERO:
            assets += balance
        elif balance < _ZERO:
            liabilities += -balance
        accounts.append(
            NetWorthAccount(
                name=row.name,
                type=row.type,
                balance=balance,
                delta_30d=_ZERO,
            )
        )

    return NetWorth(
        net_worth=assets - liabilities,
        assets=assets,
        liabilities=liabilities,
        series=[],
        accounts=accounts,
    )


@router.get(
    "/networth",
    response_model=NetWorth,
    summary=(
        "Net-worth view: totals, monthly series, per-account balances and "
        "30-day deltas. Composed from the accounts table."
    ),
)
def get_networth(
    db: Annotated[Session, Depends(get_db)],
    window: Annotated[
        str, Query(description='Rolling window selector, e.g. "3m", "12m", "ytd".')
    ] = DEFAULT_WINDOW,
) -> NetWorth:
    """Return the net-worth summary composed from the accounts table."""
    return build_networth(db, window)
