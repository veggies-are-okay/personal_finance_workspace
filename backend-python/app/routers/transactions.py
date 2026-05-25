"""``GET /api/v1/transactions`` — list/search/filter/paginate (P4.1).

The FIRST real view endpoint. It establishes the reusable read pattern the
other P4 endpoints inherit:

* a validated query model (:class:`~app.schemas.TransactionQuery`) -> canonical
  422 on bad input via the global ``RequestValidationError`` handler;
* a thin read of the precomputed/normalized ``transactions`` table (LEFT JOIN
  ``accounts`` to resolve the human account name) — no recompute;
* the ``Paginated<T>`` envelope (Appendix A / DA-4): ``total`` is the full match
  count ignoring pagination, so an ``offset`` past the end yields empty ``data``
  with a correct ``total`` (DA-4);
* a ``SERVICE_UNAVAILABLE`` 503 (DA-18) when the DB cannot be reached, raised as
  :class:`~app.errors.ServiceUnavailableError` and rendered by the global handler.

Money is serialized as a decimal **string** and dates as ``YYYY-MM-DD`` by the
response model (Appendix A).
"""

from __future__ import annotations

from datetime import date as date_cls
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Select, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import ServiceUnavailableError
from app.models import Account, Transaction as TransactionModel
from app.schemas import (
    PaginatedTransactions,
    Pagination,
    Transaction,
    TransactionQuery,
)

router = APIRouter(prefix="/api/v1", tags=["view"])


def _filtered_query(params: TransactionQuery) -> Select:
    """Build the base SELECT for transactions joined to their account name.

    Returns columns in the response order. Ordering is deterministic (date desc,
    then id desc) so both backends paginate identically.
    """
    stmt = select(
        TransactionModel.date,
        Account.name.label("account"),
        TransactionModel.description,
        TransactionModel.category,
        TransactionModel.bucket,
        TransactionModel.amount,
        TransactionModel.is_recurring,
    ).select_from(
        TransactionModel.__table__.join(
            Account.__table__,
            TransactionModel.account_id == Account.id,
            isouter=True,
        )
    )

    if params.date_from is not None:
        stmt = stmt.where(TransactionModel.date >= params.date_from)
    if params.date_to is not None:
        stmt = stmt.where(TransactionModel.date <= params.date_to)
    if params.account is not None:
        stmt = stmt.where(Account.name == params.account)
    if params.category is not None:
        stmt = stmt.where(TransactionModel.category == params.category)
    if params.q is not None:
        stmt = stmt.where(TransactionModel.description.ilike(f"%{params.q}%"))

    return stmt


def list_transactions(db: Session, params: TransactionQuery) -> PaginatedTransactions:
    """Run the query + count and assemble the ``Paginated<T>`` envelope.

    Wraps DB access so any connectivity/operational failure becomes a canonical
    503 (DA-18) instead of an unhandled 500 with a stack trace.
    """
    base = _filtered_query(params)

    try:
        # Total matching rows IGNORING pagination (DA-4): wrap the filtered query
        # in a COUNT subquery so the count survives the joins/filters.
        total = db.scalar(select(func.count()).select_from(base.subquery())) or 0

        rows = db.execute(
            base.order_by(TransactionModel.date.desc(), TransactionModel.id.desc())
            .limit(params.limit)
            .offset(params.offset)
        ).all()
    except SQLAlchemyError as exc:  # DB down / table missing / connection refused
        raise ServiceUnavailableError() from exc

    data = [
        Transaction(
            date=row.date,
            account=row.account if row.account is not None else "",
            description=row.description,
            category=row.category,
            bucket=row.bucket,
            amount=row.amount,
            is_recurring=row.is_recurring,
        )
        for row in rows
    ]
    return PaginatedTransactions(
        data=data,
        pagination=Pagination(limit=params.limit, offset=params.offset, total=total),
    )


@router.get(
    "/transactions",
    response_model=PaginatedTransactions,
    response_model_exclude_none=True,
    summary="List/search/filter transactions (paginated).",
)
def get_transactions(
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=200, description="Page size (1-200; default 50).")] = 50,
    offset: Annotated[int, Query(ge=0, description="Zero-based row offset (default 0).")] = 0,
    date_from: Annotated[
        date_cls | None, Query(description="Inclusive lower bound (YYYY-MM-DD).")
    ] = None,
    date_to: Annotated[
        date_cls | None, Query(description="Inclusive upper bound (YYYY-MM-DD).")
    ] = None,
    account: Annotated[str | None, Query(description="Account name filter.")] = None,
    category: Annotated[str | None, Query(description="Category name filter.")] = None,
    q: Annotated[str | None, Query(description="Free-text description search.")] = None,
) -> PaginatedTransactions:
    """Return a page of transactions matching the filters."""
    params = TransactionQuery(
        limit=limit,
        offset=offset,
        date_from=date_from,
        date_to=date_to,
        account=account,
        category=category,
        q=q,
    )
    return list_transactions(db, params)
