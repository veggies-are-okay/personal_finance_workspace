"""``GET /api/v1/goals`` — the Goals view (P4.6).

A thin read of the ``goals`` table (``name``, ``target``, ``saved``,
``progress_pct``) composed into the design §3 shape — NO recompute beyond
deterministic aggregation of the rows the ingestion layer wrote (DA-23). Both
backends read the SAME table, so for the same DB state FastAPI and NestJS return
byte-identical bodies (DA-9):

* ``target``        = sum of every goal's ``target``;
* ``saved``         = sum of every goal's ``saved``;
* ``progress_pct``  = overall ratio ``saved / target * 100`` (0 when target is 0);
* ``funding[]``     = one ``{source, amount}`` per goal (name + saved), sorted by
  name then id so both backends list them identically;
* ``affordability`` = a fixed-shape block. The P2.3 schema has no affordability
  table, so it is served as well-formed zeros (neither backend fabricates data).

An empty DB yields a well-formed body: ``target``/``saved`` ``"0.00"``,
``progress_pct`` ``0``, an empty ``funding`` list, and zero ``affordability``. A
DB connectivity failure becomes a canonical 503 via
:class:`~app.errors.ServiceUnavailableError` (DA-18), exactly as the other view
routers do.

Money is serialized as a decimal **string**; ``progress_pct``/``income_share``
are JSON **numbers** (0-100) (Appendix A).
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
from app.models import Goal
from app.schemas import Affordability, GoalFunding, Goals

router = APIRouter(prefix="/api/v1", tags=["view"])

# affordability has no backing table -> served as a well-formed zero block.
_ZERO_AFFORDABILITY = Affordability(
    price=Decimal("0"),
    down_payment=Decimal("0"),
    mortgage=Decimal("0"),
    monthly_piti=Decimal("0"),
    income_share=Decimal("0"),
)


def build_goals(db: Session) -> Goals:
    """Compose the ``goals`` rows into the response.

    Deterministic ordering (funding by goal name, then id) so both backends
    serialize identically. Any DB failure is mapped to a canonical 503 (DA-18).
    """
    try:
        rows = db.scalars(select(Goal).order_by(Goal.name.asc(), Goal.id.asc())).all()
    except SQLAlchemyError as exc:  # DB down / table missing / connection refused
        raise ServiceUnavailableError() from exc

    target = sum((row.target for row in rows), Decimal("0"))
    saved = sum((row.saved for row in rows), Decimal("0"))
    # Overall progress: derived from the aggregate so a single summary is
    # parity-stable across backends (per-goal progress_pct is not summed).
    progress_pct = (saved / target * 100) if target > 0 else Decimal("0")

    funding = [GoalFunding(source=row.name, amount=row.saved) for row in rows]

    return Goals(
        target=target,
        saved=saved,
        progress_pct=progress_pct,
        funding=funding,
        affordability=_ZERO_AFFORDABILITY,
    )


@router.get(
    "/goals",
    response_model=Goals,
    summary="Goals view: target, saved, progress, funding sources, affordability.",
)
def get_goals(db: Annotated[Session, Depends(get_db)]) -> Goals:
    """Return the goals summary composed from the ``goals`` table."""
    return build_goals(db)
