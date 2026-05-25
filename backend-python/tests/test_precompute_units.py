"""Pure-logic unit tests for the precompute helpers (P3.2) — no DB.

These pin the deterministic building blocks (categorization, transfer detection,
rates, recurring detection) to exact values so the golden-fixture pipeline test
has a stable spec to rest on (DA-9). All fixtures are synthetic.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.precompute.categorize import (
    bucket_for_category,
    categorize,
    is_transfer,
)
from app.precompute.rates import compute_rates
from app.precompute.recurring import RecurringSeries, detect_recurring


class TestCategorize:
    @pytest.mark.parametrize(
        ("description", "expected"),
        [
            ("UBER TRIP 123", "Transportation"),
            ("Lyft ride", "Transportation"),
            ("TRADER JOE'S #456", "Groceries"),
            ("Safeway Store", "Groceries"),
            ("NETFLIX.COM", "Subscriptions"),
            ("Corner Coffee Shop", "Dining"),
            ("Mystery Vendor LLC", "Uncategorized"),
        ],
    )
    def test_categorize(self, description: str, expected: str) -> None:
        assert categorize(description) == expected

    def test_categorize_is_deterministic(self) -> None:
        a = categorize("UBER EATS delivery")
        b = categorize("uber eats DELIVERY")
        assert a == b == "Transportation"

    @pytest.mark.parametrize(
        ("category", "bucket"),
        [
            ("Groceries", "needs"),
            ("Rent", "needs"),
            ("Dining", "wants"),
            ("Subscriptions", "wants"),
            ("Savings", "savings"),
            ("Investments", "savings"),
            ("Uncategorized", "wants"),
            ("Totally Unknown Category", "wants"),
        ],
    )
    def test_bucket_for_category(self, category: str, bucket: str) -> None:
        assert bucket_for_category(category) == bucket

    @pytest.mark.parametrize(
        ("description", "expected"),
        [
            ("Online Transfer to Savings", True),
            ("XFER FROM CHECKING", True),
            ("Card Payment - Thank You", True),
            ("AUTOPAY credit card", True),
            ("Corner Coffee Shop", False),
        ],
    )
    def test_is_transfer(self, description: str, expected: bool) -> None:
        assert is_transfer(description) is expected


class TestComputeRates:
    def test_basic_rates_are_percent_0_100(self) -> None:
        rates = compute_rates(
            gross_pay=Decimal("10000.00"),
            net_pay=Decimal("7000.00"),
            taxes=Decimal("2600.00"),
            employee_401k=Decimal("1000.00"),
            needs_spend=Decimal("3000.00"),
            wants_spend=Decimal("1500.00"),
        )
        # effective tax = 2600/10000 = 26.0
        assert rates.effective_tax_rate == Decimal("26.0")
        # cash surplus = 7000 - 3000 - 1500 = 2500; savings num = 1000 + 2500 = 3500
        # savings rate = 3500/10000 = 35.0
        assert rates.savings_rate == Decimal("35.0")

    def test_overspending_clamps_cash_surplus_to_zero(self) -> None:
        rates = compute_rates(
            gross_pay=Decimal("5000.00"),
            net_pay=Decimal("4000.00"),
            taxes=Decimal("1000.00"),
            employee_401k=Decimal("250.00"),
            needs_spend=Decimal("3000.00"),
            wants_spend=Decimal("2000.00"),  # net overspent
        )
        # cash surplus clamped to 0 -> savings num = 250 -> 250/5000 = 5.0
        assert rates.savings_rate == Decimal("5.0")
        assert rates.effective_tax_rate == Decimal("20.0")

    def test_zero_gross_is_zero_not_error(self) -> None:
        rates = compute_rates(
            gross_pay=Decimal("0"),
            net_pay=Decimal("0"),
            taxes=Decimal("0"),
            employee_401k=Decimal("0"),
            needs_spend=Decimal("0"),
            wants_spend=Decimal("0"),
        )
        assert rates.savings_rate == Decimal("0.0")
        assert rates.effective_tax_rate == Decimal("0.0")

    def test_rate_rounds_to_one_decimal(self) -> None:
        rates = compute_rates(
            gross_pay=Decimal("3000.00"),
            net_pay=Decimal("0"),
            taxes=Decimal("1000.00"),  # 33.333...% -> 33.3
            employee_401k=Decimal("0"),
            needs_spend=Decimal("0"),
            wants_spend=Decimal("0"),
        )
        assert rates.effective_tax_rate == Decimal("33.3")


class TestDetectRecurring:
    def _monthly_rows(self) -> list[tuple[str, str, date, Decimal]]:
        # Monthly streaming charge, slight day/amount jitter (within tolerance).
        return [
            ("Made-Up Streaming", "Subscriptions", date(2026, 1, 3), Decimal("-12.99")),
            ("Made-Up Streaming", "Subscriptions", date(2026, 2, 2), Decimal("-12.99")),
            ("Made-Up Streaming", "Subscriptions", date(2026, 3, 5), Decimal("-13.49")),
            ("Made-Up Streaming", "Subscriptions", date(2026, 4, 3), Decimal("-12.99")),
        ]

    def test_detects_monthly_series(self) -> None:
        series = detect_recurring(self._monthly_rows())
        assert len(series) == 1
        s = series[0]
        assert s.merchant == "Made-Up Streaming"
        assert s.cadence == "monthly"
        assert s.last_charged == date(2026, 4, 3)
        # median magnitude ~12.99 normalized to a monthly run-rate.
        assert s.monthly_est > Decimal("0")

    def test_under_three_occurrences_is_not_recurring(self) -> None:
        rows = self._monthly_rows()[:2]
        assert detect_recurring(rows) == []

    def test_unstable_amount_rejected(self) -> None:
        rows = [
            ("Var Vendor", "Shopping", date(2026, 1, 1), Decimal("-10.00")),
            ("Var Vendor", "Shopping", date(2026, 2, 1), Decimal("-10.00")),
            ("Var Vendor", "Shopping", date(2026, 3, 1), Decimal("-50.00")),  # +400%
        ]
        assert detect_recurring(rows) == []

    def test_unstable_interval_rejected(self) -> None:
        rows = [
            ("Sporadic", "Dining", date(2026, 1, 1), Decimal("-9.00")),
            ("Sporadic", "Dining", date(2026, 1, 8), Decimal("-9.00")),  # 7d gap
            ("Sporadic", "Dining", date(2026, 4, 1), Decimal("-9.00")),  # ~83d gap
        ]
        assert detect_recurring(rows) == []

    def test_weekly_cadence_label(self) -> None:
        rows = [
            ("Weekly Vendor", "Groceries", date(2026, 1, 1), Decimal("-20.00")),
            ("Weekly Vendor", "Groceries", date(2026, 1, 8), Decimal("-20.00")),
            ("Weekly Vendor", "Groceries", date(2026, 1, 15), Decimal("-20.00")),
        ]
        series = detect_recurring(rows)
        assert len(series) == 1
        assert series[0].cadence == "weekly"

    def test_output_sorted_deterministically(self) -> None:
        rows = [
            ("Zeta", "Dining", date(2026, 1, 1), Decimal("-5.00")),
            ("Zeta", "Dining", date(2026, 2, 1), Decimal("-5.00")),
            ("Zeta", "Dining", date(2026, 3, 1), Decimal("-5.00")),
            ("Alpha", "Subscriptions", date(2026, 1, 1), Decimal("-9.00")),
            ("Alpha", "Subscriptions", date(2026, 2, 1), Decimal("-9.00")),
            ("Alpha", "Subscriptions", date(2026, 3, 1), Decimal("-9.00")),
        ]
        series = detect_recurring(rows)
        assert [s.merchant for s in series] == ["Alpha", "Zeta"]

    def test_returns_recurring_series_dataclass(self) -> None:
        series = detect_recurring(self._monthly_rows())
        assert isinstance(series[0], RecurringSeries)

    def test_irregular_cadence_when_gap_matches_no_band(self) -> None:
        # ~50-day stable gaps: not weekly/biweekly/monthly/quarterly band.
        rows = [
            ("Odd Vendor", "Shopping", date(2026, 1, 1), Decimal("-30.00")),
            ("Odd Vendor", "Shopping", date(2026, 2, 20), Decimal("-30.00")),
            ("Odd Vendor", "Shopping", date(2026, 4, 11), Decimal("-30.00")),
        ]
        series = detect_recurring(rows)
        assert len(series) == 1
        assert series[0].cadence == "irregular"

    def test_all_zero_amounts_are_trivially_stable(self) -> None:
        from app.precompute.recurring import _is_stable_amount, _monthly_estimate

        assert _is_stable_amount([Decimal("0"), Decimal("0"), Decimal("0")]) is True
        # A non-positive gap returns the magnitude unchanged (no division).
        assert _monthly_estimate(Decimal("12.00"), 0.0) == Decimal("12.00")
