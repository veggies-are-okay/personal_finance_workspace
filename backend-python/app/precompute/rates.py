"""Savings-rate / effective-tax-rate computation (P3.2).

Both are emitted as **numeric percentages 0–100, one decimal** (Appendix A /
DA-22) — never money strings, never 0–1 ratios::

    effective_tax_rate = taxes / gross            (×100)
    savings_rate       = (employee_401k + cash_surplus) / gross   (×100)

where ``cash_surplus`` is the net (after-tax) money that was *not* spent on
needs/wants in the window — i.e. ``net_pay - (needs + wants)``. The employee
401(k) contribution is pre-tax savings and is added on top. Rates are derived
from ``paystubs`` income + the categorized spending totals so they are fully
deterministic for golden-fixture tests (DA-9).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

_PCT_QUANT = Decimal("0.1")  # one decimal place (e.g. 26.0)
_ZERO = Decimal("0")


@dataclass(frozen=True)
class Rates:
    """The two precomputed budget scalars, as numeric percentages 0–100."""

    savings_rate: Decimal
    effective_tax_rate: Decimal


def _pct(numerator: Decimal, denominator: Decimal) -> Decimal:
    """``numerator/denominator`` as a percentage 0–100, one decimal (DA-22).

    Returns ``0.0`` when the denominator is zero (no income → no rate), so the
    aggregate is always a well-formed number.
    """
    if denominator == _ZERO:
        return Decimal("0.0")
    pct = (numerator / denominator) * Decimal("100")
    return pct.quantize(_PCT_QUANT, rounding=ROUND_HALF_UP)


def compute_rates(
    *,
    gross_pay: Decimal,
    net_pay: Decimal,
    taxes: Decimal,
    employee_401k: Decimal,
    needs_spend: Decimal,
    wants_spend: Decimal,
) -> Rates:
    """Compute savings + effective-tax rates as numeric percentages (DA-22).

    ``needs_spend`` / ``wants_spend`` are positive spending magnitudes for the
    window. ``cash_surplus = net_pay - needs - wants`` (clamped at 0 so an
    overspending window reports a 0% — never negative — cash contribution); the
    pre-tax 401(k) is added as additional savings.
    """
    cash_surplus = net_pay - needs_spend - wants_spend
    if cash_surplus < _ZERO:
        cash_surplus = _ZERO
    savings_numerator = employee_401k + cash_surplus
    return Rates(
        savings_rate=_pct(savings_numerator, gross_pay),
        effective_tax_rate=_pct(taxes, gross_pay),
    )
