"""Precompute orchestrator (P3.2): transactions + income → aggregate tables.

``run_precompute`` is the single entry point. For one ``window`` it:

1. Reads ``transactions`` and **enriches** each row in place — ``category``,
   ``bucket`` (50/30/20), ``is_transfer``, ``is_recurring``.
2. Reads ``paystubs`` income for the window's totals (gross / net / taxes /
   employee 401(k)).
3. Computes the per-category, per-bucket, per-month spending totals and the two
   scalar rates (savings / effective-tax — numeric 0–100, DA-22).
4. Detects recurring series (≥3 occurrences, stable interval/amount).
5. **Replaces** the precomputed rows for that ``window`` in
   ``budget_aggregates`` + ``budget_{bucket,category,monthly}_aggregates`` and
   replaces ``recurring_charges`` wholesale — so a re-run is idempotent and the
   tables always reflect the latest computation (DA-9). Both backends later read
   these tables verbatim (no recompute).

The caller owns the transaction boundary (commit/rollback). All money is
``Decimal``; spending is summed from **negative money-out** amounts and stored as
positive magnitudes (the Budget screen shows spend as a positive number).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date as date_cls
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (
    BUCKET_VALUES,
    BudgetAggregate,
    BudgetBucketAggregate,
    BudgetCategoryAggregate,
    BudgetMonthlyAggregate,
    Paystub,
    RecurringCharge,
    Transaction,
)
from app.precompute.categorize import bucket_for_category, categorize, is_transfer
from app.precompute.rates import compute_rates
from app.precompute.recurring import detect_recurring

_CENTS = Decimal("0.01")
_PCT_QUANT = Decimal("0.1")
_ZERO = Decimal("0")
NEEDS, WANTS, SAVINGS = BUCKET_VALUES

# Canonical 50/30/20 targets (percent of after-tax income), per bucket.
_TARGET_PCT: dict[str, Decimal] = {
    NEEDS: Decimal("50.0"),
    WANTS: Decimal("30.0"),
    SAVINGS: Decimal("20.0"),
}


def _q(amount: Decimal) -> Decimal:
    return amount.quantize(_CENTS, rounding=ROUND_HALF_UP)


def _pct(numerator: Decimal, denominator: Decimal) -> Decimal:
    if denominator == _ZERO:
        return Decimal("0.0")
    return ((numerator / denominator) * Decimal("100")).quantize(_PCT_QUANT, rounding=ROUND_HALF_UP)


@dataclass
class PrecomputeResult:
    """Summary of one precompute run (returned for proofs/tests)."""

    window: str
    savings_rate: Decimal
    effective_tax_rate: Decimal
    bucket_amounts: dict[str, Decimal] = field(default_factory=dict)
    category_count: int = 0
    monthly_count: int = 0
    recurring_count: int = 0
    transactions_enriched: int = 0


def _income_totals(session: Session) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    """Sum ``paystubs`` income: (gross, net, taxes, employee 401k)."""
    gross = net = taxes = emp_401k = _ZERO
    for stub in session.scalars(select(Paystub)).all():
        gross += Decimal(stub.gross_pay)
        net += Decimal(stub.net_pay)
        taxes += Decimal(stub.taxes)
        emp_401k += Decimal(stub.retirement_401k_employee)
    return gross, net, taxes, emp_401k


def run_precompute(session: Session, *, window: str = "all") -> PrecomputeResult:
    """Enrich transactions and (re)write every ``/budget`` aggregate for ``window``.

    Idempotent: the precomputed rows for ``window`` are deleted and rewritten,
    and ``recurring_charges`` is replaced wholesale, so two runs over the same
    data produce identical tables (DA-9).
    """
    txns = session.scalars(select(Transaction)).all()

    # 1. Enrich each transaction (category / bucket / transfer / recurring).
    category_totals: dict[str, Decimal] = defaultdict(lambda: _ZERO)
    category_bucket: dict[str, str] = {}
    bucket_totals: dict[str, Decimal] = {b: _ZERO for b in BUCKET_VALUES}
    monthly: dict[str, dict[str, Decimal]] = defaultdict(lambda: {NEEDS: _ZERO, WANTS: _ZERO})
    recurring_inputs: list[tuple[str, str, date_cls, Decimal]] = []

    for txn in txns:
        category = categorize(txn.description)
        transfer = is_transfer(txn.description)
        bucket = SAVINGS if transfer else bucket_for_category(category)
        txn.category = category
        txn.bucket = bucket
        txn.is_transfer = transfer

        amount = Decimal(txn.amount)
        # Spending magnitude: only money-out (negative) counts as spend.
        spend = (-amount) if amount < _ZERO else _ZERO

        # Recurring detection considers money-out charges only.
        if spend > _ZERO:
            recurring_inputs.append((category, category, txn.date, amount))

        # Transfers and inflows are excluded from needs/wants spending totals.
        if not transfer and spend > _ZERO and bucket in (NEEDS, WANTS):
            category_totals[category] += spend
            category_bucket[category] = bucket
            bucket_totals[bucket] += spend
            month_key = f"{txn.date.year:04d}-{txn.date.month:02d}"
            monthly[month_key][bucket] += spend

    # 2. Recurring detection → flag transactions + build recurring rows.
    recurring_series = detect_recurring(recurring_inputs)
    recurring_categories = {s.merchant for s in recurring_series}
    for txn in txns:
        txn.is_recurring = txn.category in recurring_categories and Decimal(txn.amount) < _ZERO

    # 3. Income + the two scalar rates (numeric 0–100, DA-22).
    gross, net, taxes, emp_401k = _income_totals(session)
    rates = compute_rates(
        gross_pay=gross,
        net_pay=net,
        taxes=taxes,
        employee_401k=emp_401k,
        needs_spend=bucket_totals[NEEDS],
        wants_spend=bucket_totals[WANTS],
    )
    # Savings-bucket amount = the 401(k) + cash surplus (matches savings_rate).
    cash_surplus = net - bucket_totals[NEEDS] - bucket_totals[WANTS]
    if cash_surplus < _ZERO:
        cash_surplus = _ZERO
    bucket_totals[SAVINGS] = emp_401k + cash_surplus

    # Actual-% per bucket is its share of after-tax (net) income.
    denom = net if net > _ZERO else _ZERO

    # 4. Replace this window's aggregate rows (idempotent re-run).
    _clear_window(session, window)
    session.execute(delete(RecurringCharge))

    session.add(
        BudgetAggregate(
            window=window,
            savings_rate=rates.savings_rate,
            effective_tax_rate=rates.effective_tax_rate,
        )
    )
    for bucket in BUCKET_VALUES:
        session.add(
            BudgetBucketAggregate(
                window=window,
                name=bucket,
                target_pct=_TARGET_PCT[bucket],
                actual_pct=_pct(bucket_totals[bucket], denom),
                amount=_q(bucket_totals[bucket]),
            )
        )
    for category in sorted(category_totals):
        session.add(
            BudgetCategoryAggregate(
                window=window,
                name=category,
                amount=_q(category_totals[category]),
                bucket=category_bucket[category],
            )
        )
    for month_key in sorted(monthly):
        session.add(
            BudgetMonthlyAggregate(
                window=window,
                month=month_key,
                needs=_q(monthly[month_key][NEEDS]),
                wants=_q(monthly[month_key][WANTS]),
            )
        )
    for s in recurring_series:
        session.add(
            RecurringCharge(
                merchant=s.merchant,
                category=s.category,
                cadence=s.cadence,
                last_charged=s.last_charged,
                monthly_est=s.monthly_est,
            )
        )

    return PrecomputeResult(
        window=window,
        savings_rate=rates.savings_rate,
        effective_tax_rate=rates.effective_tax_rate,
        bucket_amounts={b: _q(bucket_totals[b]) for b in BUCKET_VALUES},
        category_count=len(category_totals),
        monthly_count=len(monthly),
        recurring_count=len(recurring_series),
        transactions_enriched=len(txns),
    )


def _clear_window(session: Session, window: str) -> None:
    """Delete the precomputed aggregate rows for ``window`` (idempotent re-run)."""
    for model in (
        BudgetAggregate,
        BudgetBucketAggregate,
        BudgetCategoryAggregate,
        BudgetMonthlyAggregate,
    ):
        session.execute(delete(model).where(model.window == window))
