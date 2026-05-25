"""``GET /api/v1/budget`` — the Budget view (P4.2).

A thin read that composes the **precomputed** aggregate tables written by the
P3.2 ingestion pipeline into the design §3 shape — NO categorization/recompute
happens in the backend (DA-23). Both backends read the SAME tables, so for the
same DB state FastAPI and NestJS return byte-identical bodies (DA-9):

* ``budget_aggregates``           -> ``savings_rate`` + ``effective_tax_rate``
* ``budget_bucket_aggregates``    -> ``buckets[]``  (50/30/20)
* ``budget_category_aggregates``  -> ``categories[]``
* ``budget_monthly_aggregates``   -> ``monthly[]``
* ``recurring_charges``           -> ``recurring[]``

The aggregate rows are scoped by a ``window`` selector (default ``12m``); the
``recurring_charges`` table is window-independent. An empty DB yields a
well-formed body with zero rates and empty arrays. A DB connectivity failure
becomes a canonical 503 via :class:`~app.errors.ServiceUnavailableError`
(DA-18), exactly as the transactions router does.

Money is serialized as a decimal **string**, percentages as JSON **numbers**
(0-100, one decimal), dates as ``YYYY-MM-DD`` (Appendix A).
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
from app.models import (
    BudgetAggregate,
    BudgetBucketAggregate,
    BudgetCategoryAggregate,
    BudgetMonthlyAggregate,
    RecurringCharge,
)
from app.schemas import (
    Budget,
    BudgetBucket,
    BudgetCategory,
    MonthlyNeedsWants,
    RecurringChargeOut,
)

router = APIRouter(prefix="/api/v1", tags=["view"])

DEFAULT_WINDOW = "12m"

# Canonical bucket ordering so both backends list buckets identically.
_BUCKET_ORDER = {"needs": 0, "wants": 1, "savings": 2}


def build_budget(db: Session, window: str) -> Budget:
    """Compose the precomputed aggregate rows for ``window`` into the response.

    Deterministic ordering (buckets by 50/30/20 order; categories by name;
    monthly by month; recurring by merchant) so both backends paginate/serialize
    identically. Any DB failure is mapped to a canonical 503 (DA-18).
    """
    try:
        agg = db.scalar(select(BudgetAggregate).where(BudgetAggregate.window == window))
        bucket_rows = db.scalars(
            select(BudgetBucketAggregate).where(BudgetBucketAggregate.window == window)
        ).all()
        category_rows = db.scalars(
            select(BudgetCategoryAggregate)
            .where(BudgetCategoryAggregate.window == window)
            .order_by(BudgetCategoryAggregate.name.asc())
        ).all()
        monthly_rows = db.scalars(
            select(BudgetMonthlyAggregate)
            .where(BudgetMonthlyAggregate.window == window)
            .order_by(BudgetMonthlyAggregate.month.asc())
        ).all()
        recurring_rows = db.scalars(
            select(RecurringCharge).order_by(RecurringCharge.merchant.asc())
        ).all()
    except SQLAlchemyError as exc:  # DB down / table missing / connection refused
        raise ServiceUnavailableError() from exc

    # Empty DB -> well-formed zeros + empty arrays (parity across both backends).
    savings_rate = agg.savings_rate if agg is not None else Decimal("0")
    effective_tax_rate = agg.effective_tax_rate if agg is not None else Decimal("0")

    buckets = [
        BudgetBucket(
            name=row.name,
            target_pct=row.target_pct,
            actual_pct=row.actual_pct,
            amount=row.amount,
        )
        for row in sorted(bucket_rows, key=lambda r: _BUCKET_ORDER.get(r.name, 99))
    ]
    categories = [
        BudgetCategory(name=row.name, amount=row.amount, bucket=row.bucket) for row in category_rows
    ]
    monthly = [
        MonthlyNeedsWants(month=row.month, needs=row.needs, wants=row.wants) for row in monthly_rows
    ]
    recurring = [
        RecurringChargeOut(
            merchant=row.merchant,
            category=row.category,
            cadence=row.cadence,
            last_charged=row.last_charged,
            monthly_est=row.monthly_est,
        )
        for row in recurring_rows
    ]

    return Budget(
        savings_rate=savings_rate,
        effective_tax_rate=effective_tax_rate,
        buckets=buckets,
        categories=categories,
        monthly=monthly,
        recurring=recurring,
    )


@router.get(
    "/budget",
    response_model=Budget,
    summary=(
        "Budget view: savings rate, tax rate, 50/30/20 buckets, categories, "
        "monthly needs/wants, recurring charges. Served from precomputed tables."
    ),
)
def get_budget(
    db: Annotated[Session, Depends(get_db)],
    window: Annotated[
        str, Query(description='Rolling window selector, e.g. "3m", "12m", "ytd".')
    ] = DEFAULT_WINDOW,
) -> Budget:
    """Return the precomputed budget summary for ``window`` (default ``12m``)."""
    return build_budget(db, window)
