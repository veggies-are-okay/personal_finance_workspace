"""``GET /api/v1/investments`` — the Investments view (P4.4).

A thin read of the ``holdings`` table composed into the design §3 shape. NO
analytics are recomputed in the backend: portfolio totals and the allocation /
concentration percentages are simple, deterministic aggregations of the stored
holding rows. Both backends apply the SAME aggregation to the SAME rows, so for
identical DB state FastAPI and NestJS return byte-identical bodies (DA-9):

* ``portfolio_value`` = sum of every holding's ``value``;
* ``unrealized_gain`` = sum of every holding's ``gain``;
* ``allocation[]``    = holdings grouped by ``asset_class`` -> per class
  ``amount`` (sum of value), ``actual_pct`` (class share of the portfolio's
  market value), and ``target_pct`` (sum of the class's stored per-holding
  ``weight`` values, i.e. the intended allocation);
* ``concentration[]`` = per holding ``{holding: symbol, weight}`` where weight
  is the holding's market-value share of the portfolio (single-position risk);
* ``holdings[]``      = the holding rows verbatim (the stored per-holding
  ``weight`` is the holding's intended portfolio weight).

Ordering is deterministic so both backends serialize identically: allocation by
class name; concentration by descending weight then symbol; holdings by symbol.
An empty DB yields ``"0.00"`` totals and empty arrays. A DB connectivity failure
becomes a canonical 503 via :class:`~app.errors.ServiceUnavailableError`
(DA-18), exactly as the transactions/budget routers do.

Money is serialized as a decimal **string**, percentages as JSON **numbers**
(0-100, one decimal) per Appendix A.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import ServiceUnavailableError
from app.models import Holding as HoldingModel
from app.schemas import (
    Allocation,
    Concentration,
    Holding,
    Investments,
)

router = APIRouter(prefix="/api/v1", tags=["view"])

# Asset class used for holdings whose ``asset_class`` column is NULL. Stable so
# both backends bucket un-classified holdings into the same allocation row.
UNCLASSIFIED = "unclassified"


def _pct(part: Decimal, whole: Decimal) -> Decimal:
    """Return ``part / whole`` as a percentage (0-100); 0 when ``whole`` is 0.

    Both backends compute the same way: the wire serializer (``_percent_num``)
    then quantizes to one decimal place, so the numbers match exactly.
    """
    if whole == 0:
        return Decimal("0")
    return part / whole * Decimal("100")


def build_investments(db: Session) -> Investments:
    """Compose the ``holdings`` rows into the Investments response.

    Deterministic ordering (allocation by class; concentration by weight desc
    then symbol; holdings by symbol) so both backends serialize identically. Any
    DB failure is mapped to a canonical 503 (DA-18).
    """
    try:
        rows = db.scalars(select(HoldingModel).order_by(HoldingModel.symbol.asc())).all()
    except SQLAlchemyError as exc:  # DB down / table missing / connection refused
        raise ServiceUnavailableError() from exc

    portfolio_value = sum((row.value for row in rows), Decimal("0"))
    unrealized_gain = sum((row.gain for row in rows), Decimal("0"))

    # Group by asset class for the allocation breakdown. Accumulate the class's
    # market value (-> amount + actual_pct) and the sum of stored per-holding
    # weights (-> target_pct, the intended allocation).
    class_amount: dict[str, Decimal] = {}
    class_target: dict[str, Decimal] = {}
    for row in rows:
        asset_class = row.asset_class or UNCLASSIFIED
        class_amount[asset_class] = class_amount.get(asset_class, Decimal("0")) + row.value
        class_target[asset_class] = class_target.get(asset_class, Decimal("0")) + row.weight

    allocation = [
        Allocation(
            class_=asset_class,
            target_pct=class_target[asset_class],
            actual_pct=_pct(class_amount[asset_class], portfolio_value),
            amount=class_amount[asset_class],
        )
        for asset_class in sorted(class_amount)
    ]

    # Concentration: each holding's market-value share, ranked by descending
    # weight then symbol (a stable tiebreak so both backends agree).
    concentration = [
        Concentration(holding=row.symbol, weight=_pct(row.value, portfolio_value))
        for row in sorted(rows, key=lambda r: (-_pct(r.value, portfolio_value), r.symbol))
    ]

    holdings = [
        Holding(
            symbol=row.symbol,
            name=row.name,
            value=row.value,
            weight=row.weight,
            gain=row.gain,
        )
        for row in rows  # already ordered by symbol
    ]

    return Investments(
        portfolio_value=portfolio_value,
        unrealized_gain=unrealized_gain,
        allocation=allocation,
        concentration=concentration,
        holdings=holdings,
    )


@router.get(
    "/investments",
    response_model=Investments,
    response_model_by_alias=True,
    summary=(
        "Investments view: portfolio value, unrealized gain, allocation, "
        "concentration, holdings. A thin read of the holdings table."
    ),
)
def get_investments(db: Annotated[Session, Depends(get_db)]) -> Investments:
    """Return the investments summary derived from the ``holdings`` table."""
    return build_investments(db)
