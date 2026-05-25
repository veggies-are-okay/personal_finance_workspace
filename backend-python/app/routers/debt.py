"""``GET /api/v1/debt`` — the Debt view (P4.5).

A thin read of the ``loans`` table (the rows are owner-provided / ingested; this
endpoint does NOT recompute them). It composes the design §3 Debt shape:

* ``total``             -> sum of loan balances;
* ``weighted_avg_rate`` -> balance-weighted average interest rate (number 0-100);
* ``monthly_minimum``   -> sum of loan minimum payments;
* ``tranches[]``        -> loans grouped by ``(rate, priority)``, ordered by rate
  desc then priority, each with a summed balance + a ``loan_count``;
* ``payoff[]``          -> BOTH the ``avalanche`` (highest-rate-first
  acceleration) and ``minimums`` (pay only the minimums) projections, computed
  with a deterministic integer-cent monthly amortization (see
  :func:`project_payoff`) so FastAPI and NestJS produce byte-identical numbers;
* ``loans[]``           -> the underlying loan rows (name/balance/rate/minimum/
  priority), ordered by rate desc then name.

The ``strategy`` query param is accepted (canonical contract) but does NOT change
the response shape — both projections are always returned so the Debt screen can
show the comparison; an unknown value -> canonical 422 via the validated query
model. Empty DB -> well-formed zeros + empty arrays (and two zero projections).

Wire conventions (Appendix A): money is a 2dp decimal STRING (DA-2); rates are
JSON NUMBERS 0-100 (DA-22); enums are the lower_snake values shared with
``app.models``. A DB failure becomes a canonical 503 (DA-18).
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import ServiceUnavailableError
from app.models import Loan as LoanModel
from app.schemas import (
    Debt,
    DebtTranche,
    LoanOut,
    PayoffProjection,
    PayoffStrategy,
)

router = APIRouter(prefix="/api/v1", tags=["view"])

# A horizon cap so a non-amortizing loan (minimum below the monthly interest)
# terminates the simulation deterministically instead of looping forever. 50yr.
_MAX_MONTHS = 600
# The reference "today" used to translate a payoff month count into a calendar
# year for ``debt_free_year``. Fixed so both backends and the parity test agree
# on the projected year regardless of the wall clock. (Synthetic / deterministic.)
_BASE_YEAR = 2026
_BASE_MONTH = 1  # January 2026


def _cents(value: Decimal) -> int:
    """Round a Decimal dollar amount to integer cents (half-up)."""
    return int((value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _monthly_rate(annual_pct: Decimal) -> Decimal:
    """Convert an annual percentage (e.g. ``6.8``) to a monthly fractional rate."""
    return (annual_pct / Decimal(100)) / Decimal(12)


def project_payoff(loans: list[LoanOut], *, accelerate: bool) -> tuple[int, Decimal]:
    """Simulate paying off ``loans`` month-by-month in integer cents.

    Returns ``(months, total_interest)``. The simulation is fully deterministic
    (integer-cent arithmetic, half-up rounding of accrued interest) so the
    TypeScript twin produces identical numbers.

    * ``accelerate=False`` (minimums): each loan receives exactly its minimum
      payment every month until paid off.
    * ``accelerate=True`` (avalanche): the total monthly budget equals the sum of
      all *original* minimum payments; minimums are paid on every loan, then any
      leftover budget (including minimums freed up as loans are retired) is thrown
      entirely at the highest-rate outstanding loan first.

    Interest accrues monthly on the outstanding balance BEFORE the payment is
    applied. The horizon is capped at :data:`_MAX_MONTHS`.
    """
    # Working state in integer cents, ordered highest-rate-first for avalanche.
    order = sorted(
        range(len(loans)),
        key=lambda i: (-loans[i].rate, loans[i].name),
    )
    balances = [_cents(loan.balance) for loan in loans]
    minimums = [_cents(loan.minimum_payment) for loan in loans]
    rates = [_monthly_rate(loan.rate) for loan in loans]

    budget = sum(minimums)
    total_interest_cents = 0
    months = 0

    while any(b > 0 for b in balances) and months < _MAX_MONTHS:
        months += 1
        outstanding_before = sum(b for b in balances if b > 0)

        # 1. Accrue interest on every outstanding balance (half-up to a cent).
        for i, bal in enumerate(balances):
            if bal <= 0:
                continue
            interest = _cents((Decimal(bal) / 100) * rates[i])
            balances[i] = bal + interest
            total_interest_cents += interest

        # 2. Pay the minimum on every outstanding loan (capped at the balance).
        available = budget if accelerate else None
        for i, bal in enumerate(balances):
            if bal <= 0:
                continue
            pay = min(minimums[i], bal)
            balances[i] = bal - pay
            if accelerate and available is not None:
                available -= pay

        # 3. Avalanche: throw the leftover budget at the highest-rate loan first.
        if accelerate and available is not None and available > 0:
            for i in order:
                if available <= 0:
                    break
                if balances[i] <= 0:
                    continue
                pay = min(available, balances[i])
                balances[i] -= pay
                available -= pay

        # Guard against a non-amortizing loan (minimum <= accrued interest): if
        # the total outstanding principal did not shrink this month, the debt
        # will never clear under this plan -> stop at the horizon deterministically.
        outstanding_after = sum(b for b in balances if b > 0)
        if outstanding_after >= outstanding_before:
            months = _MAX_MONTHS
            break

    return months, (Decimal(total_interest_cents) / 100)


def _months_to_year(months: int) -> int:
    """Translate a payoff month count into the calendar year debt is cleared."""
    if months <= 0:
        return 0
    # Month 1 is _BASE_MONTH of _BASE_YEAR; advance (months-1) months from there.
    zero_based = (_BASE_MONTH - 1) + (months - 1)
    return _BASE_YEAR + (zero_based // 12)


def _weighted_avg_rate(loans: list[LoanOut]) -> Decimal:
    """Balance-weighted average interest rate (0 when no balance)."""
    total_balance = sum((loan.balance for loan in loans), Decimal(0))
    if total_balance <= 0:
        return Decimal(0)
    weighted = sum((loan.balance * loan.rate for loan in loans), Decimal(0))
    return weighted / total_balance


def _build_tranches(loans: list[LoanOut]) -> list[DebtTranche]:
    """Group loans by ``(rate, priority)`` into rate tranches.

    Ordered by rate desc, then by the canonical priority order, so both backends
    emit identical tranche lists.
    """
    groups: dict[tuple[Decimal, str], list[LoanOut]] = {}
    for loan in loans:
        groups.setdefault((loan.rate, loan.priority.value), []).append(loan)

    priority_order = {"pay_first": 0, "then": 1, "minimums": 2}
    keys = sorted(groups, key=lambda k: (-k[0], priority_order.get(k[1], 99)))
    return [
        DebtTranche(
            rate=rate,
            balance=sum((loan.balance for loan in groups[(rate, priority)]), Decimal(0)),
            loan_count=len(groups[(rate, priority)]),
            priority=priority,
        )
        for (rate, priority) in keys
    ]


def build_debt(db: Session) -> Debt:
    """Compose the ``loans`` rows into the design §3 Debt response.

    Any DB failure is mapped to a canonical 503 (DA-18). An empty table yields a
    well-formed body: zero totals/rate, empty tranches/loans, and two
    zero-interest payoff projections.
    """
    try:
        rows = db.scalars(select(LoanModel)).all()
    except SQLAlchemyError as exc:  # DB down / table missing / connection refused
        raise ServiceUnavailableError() from exc

    # Loans ordered by rate desc then name (deterministic across both backends).
    loans = [
        LoanOut(
            name=row.name,
            balance=row.balance,
            rate=row.rate,
            minimum_payment=row.minimum_payment,
            priority=row.priority,
        )
        for row in sorted(rows, key=lambda r: (-r.rate, r.name))
    ]

    total = sum((loan.balance for loan in loans), Decimal(0))
    monthly_minimum = sum((loan.minimum_payment for loan in loans), Decimal(0))

    aval_months, aval_interest = project_payoff(loans, accelerate=True)
    min_months, min_interest = project_payoff(loans, accelerate=False)

    payoff = [
        PayoffProjection(
            strategy="avalanche",
            debt_free_year=_months_to_year(aval_months),
            total_interest=aval_interest,
        ),
        PayoffProjection(
            strategy="minimums",
            debt_free_year=_months_to_year(min_months),
            total_interest=min_interest,
        ),
    ]

    return Debt(
        total=total,
        weighted_avg_rate=_weighted_avg_rate(loans),
        monthly_minimum=monthly_minimum,
        tranches=_build_tranches(loans),
        payoff=payoff,
        loans=loans,
    )


@router.get(
    "/debt",
    response_model=Debt,
    response_model_exclude_none=True,
    summary=(
        "Debt view: total, weighted-average rate, monthly minimum, rate tranches, "
        "avalanche-vs-minimums payoff projections, and the underlying loans."
    ),
)
def get_debt(
    db: Annotated[Session, Depends(get_db)],
    strategy: Annotated[
        PayoffStrategy | None,
        Query(description="Payoff strategy to highlight (avalanche | minimums)."),
    ] = None,
) -> Debt:
    """Return the debt summary.

    ``strategy`` is validated against the payoff-strategy registry (an unknown
    value -> canonical 422, mirroring the NestJS enum DTO) but does NOT change
    the response shape — both projections are always returned so the Debt screen
    can render the comparison.
    """
    return build_debt(db)
