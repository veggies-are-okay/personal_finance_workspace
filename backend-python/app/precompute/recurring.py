"""Recurring-charge detection (P3.2).

Groups a window's transactions by ``(merchant, category)`` and flags a group as
**recurring** when it satisfies all three deterministic criteria (DA-9):

* **≥ 3 occurrences** — a one-off or a pair is not a series.
* **stable interval (±7 days)** — every gap between consecutive charges is
  within 7 days of the group's *median* gap (so a monthly bill that lands a few
  days early/late still counts).
* **stable amount (±15%)** — every charge magnitude is within 15% of the
  group's median magnitude.

The cadence label is derived from the median gap (weekly / biweekly / monthly /
quarterly / yearly). ``monthly_est`` normalizes the median charge to a monthly
figure so the Budget screen can show a comparable run-rate. All money is
``Decimal``; magnitudes use the absolute value (charges are negative money-out).
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from datetime import date as date_cls
from decimal import ROUND_HALF_UP, Decimal

_CENTS = Decimal("0.01")

MIN_OCCURRENCES = 3
INTERVAL_TOLERANCE_DAYS = 7
AMOUNT_TOLERANCE = Decimal("0.15")  # ±15%

# (label, expected days, +- tolerance window) checked in order; first match wins.
_CADENCE_BANDS: tuple[tuple[str, int, int], ...] = (
    ("weekly", 7, 3),
    ("biweekly", 14, 4),
    ("monthly", 30, 7),
    ("quarterly", 91, 15),
    ("yearly", 365, 30),
)
# Average days per month, for normalizing a cadence to a monthly run-rate.
_DAYS_PER_MONTH = Decimal("30.44")


@dataclass(frozen=True)
class RecurringSeries:
    """One detected recurring series (one ``recurring_charges`` row)."""

    merchant: str
    category: str
    cadence: str
    last_charged: date_cls
    monthly_est: Decimal


@dataclass
class _Occurrence:
    when: date_cls
    amount: Decimal  # signed (negative = money out)


def _quantize(amount: Decimal) -> Decimal:
    return amount.quantize(_CENTS, rounding=ROUND_HALF_UP)


def _cadence_for_gap(median_gap: float) -> str:
    """Label the median inter-charge gap; nearest band, else ``irregular``."""
    for label, expected, tol in _CADENCE_BANDS:
        if abs(median_gap - expected) <= tol:
            return label
    return "irregular"


def _monthly_estimate(median_amount: Decimal, median_gap: float) -> Decimal:
    """Normalize a per-charge magnitude to a monthly run-rate."""
    if median_gap <= 0:
        return _quantize(median_amount)
    charges_per_month = _DAYS_PER_MONTH / Decimal(str(median_gap))
    return _quantize(median_amount * charges_per_month)


def _is_stable_amount(magnitudes: list[Decimal]) -> bool:
    """True when every magnitude is within ±15% of the median magnitude."""
    median = Decimal(str(statistics.median(magnitudes)))
    if median == 0:
        # All-zero amounts: trivially "stable".
        return all(m == 0 for m in magnitudes)
    lo = median * (Decimal("1") - AMOUNT_TOLERANCE)
    hi = median * (Decimal("1") + AMOUNT_TOLERANCE)
    return all(lo <= m <= hi for m in magnitudes)


def _is_stable_interval(gaps: list[int]) -> bool:
    """True when every consecutive gap is within ±7 days of the median gap."""
    median = statistics.median(gaps)
    return all(abs(g - median) <= INTERVAL_TOLERANCE_DAYS for g in gaps)


def detect_recurring(
    rows: list[tuple[str, str, date_cls, Decimal]],
) -> list[RecurringSeries]:
    """Detect recurring series from ``(merchant, category, date, amount)`` rows.

    ``amount`` is signed (negative = money out). Returns one
    :class:`RecurringSeries` per qualifying ``(merchant, category)`` group,
    sorted by merchant then category for deterministic output (DA-9).
    """
    groups: dict[tuple[str, str], list[_Occurrence]] = {}
    for merchant, category, when, amount in rows:
        groups.setdefault((merchant, category), []).append(_Occurrence(when, amount))

    series: list[RecurringSeries] = []
    for (merchant, category), occ in sorted(groups.items()):
        if len(occ) < MIN_OCCURRENCES:
            continue
        occ.sort(key=lambda o: o.when)
        gaps = [(occ[i].when - occ[i - 1].when).days for i in range(1, len(occ))]
        if not gaps or not _is_stable_interval(gaps):
            continue
        magnitudes = [o.amount.copy_abs() for o in occ]
        if not _is_stable_amount(magnitudes):
            continue
        median_gap = float(statistics.median(gaps))
        median_amount = Decimal(str(statistics.median(magnitudes)))
        series.append(
            RecurringSeries(
                merchant=merchant,
                category=category,
                cadence=_cadence_for_gap(median_gap),
                last_charged=occ[-1].when,
                monthly_est=_monthly_estimate(median_amount, median_gap),
            )
        )
    return series
