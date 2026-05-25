"""Pydantic v2 response/request schemas (shape the OpenAPI contract).

Appendix A wire conventions enforced here:

* **Money** is a fixed-2dp decimal **string** (never a JSON number). The model
  stores a ``Decimal`` and a ``field_serializer`` renders ``f"{v:.2f}"``.
* **Dates** are ``YYYY-MM-DD``; ``date`` serializes that way natively.
* **Null vs absent**: optional fields use ``exclude_none`` so an absent value is
  OMITTED from the JSON, never emitted as ``null`` (matches NestJS dropping
  ``undefined``). Required fields are always present.
* **Enums** are lower_snake string values shared with the canonical registry.
"""

from __future__ import annotations

from datetime import date as date_cls
from decimal import Decimal
from enum import Enum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, WithJsonSchema, field_serializer


class HealthResponse(BaseModel):
    """Canonical ``GET /health`` response body.

    Kept trivially identical across backends (see backend-ts parity twin):
    always ``{"status": "ok"}``. Does not depend on the database.
    """

    status: str


class Bucket(str, Enum):
    """50/30/20 bucket enum (Appendix A registry; lower_snake values)."""

    needs = "needs"
    wants = "wants"
    savings = "savings"


# Optional string fields are typed ``str | None`` so they are OMITTED at runtime
# when absent (``exclude_none``). Without help Pydantic would render their OpenAPI
# schema as ``anyOf: [{string},{null}]`` (no top-level ``type``), which the parity
# normalizer reduces to ``type: "unknown"`` — diverging from the canonical (and
# NestJS) ``type: "string"``. ``WithJsonSchema`` forces the wire schema to a plain
# string so all three documents normalize identically. (We cannot edit the frozen
# canonical doc — DA-25 — so the backends conform to it.)
_OptionalString = Annotated[
    str | None,
    WithJsonSchema({"type": "string"}),
]


class Transaction(BaseModel):
    """One transaction row in the paginated ``/api/v1/transactions`` response.

    ``category`` and ``bucket`` are optional and OMITTED when absent (never
    ``null``). ``amount`` is a decimal string; ``date`` is ``YYYY-MM-DD``.
    """

    model_config = ConfigDict(exclude_none=True)

    date: date_cls
    account: str
    description: str
    category: _OptionalString = None
    bucket: _OptionalString = None
    amount: Decimal
    is_recurring: bool

    @field_serializer("amount")
    def _serialize_amount(self, value: Decimal) -> str:
        """Render money as a fixed-2dp decimal string (Appendix A / DA-2)."""
        return f"{value:.2f}"


class Pagination(BaseModel):
    """The ``pagination`` block of the ``Paginated<T>`` envelope (DA-4)."""

    limit: int
    offset: int
    total: int


class PaginatedTransactions(BaseModel):
    """The ``{data, pagination}`` envelope for the transactions list (DA-4).

    ``exclude_none`` propagates so each item omits its absent optional fields.
    """

    model_config = ConfigDict(exclude_none=True)

    data: list[Transaction]
    pagination: Pagination


class TransactionQuery(BaseModel):
    """Validated query params for ``GET /api/v1/transactions``.

    Mirrors the canonical contract parameters (and the NestJS DTO):
    ``limit`` (1-200, default 50), ``offset`` (>=0, default 0), and the optional
    ``date_from``/``date_to``/``account``/``category``/``q`` filters. Invalid
    values raise ``RequestValidationError`` -> canonical 422.
    """

    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=50, ge=1, le=200)
    offset: int = Field(default=0, ge=0)
    date_from: date_cls | None = None
    date_to: date_cls | None = None
    account: str | None = None
    category: str | None = None
    q: str | None = None


# --- Budget view (P4.2) ----------------------------------------------------
#
# ``GET /api/v1/budget`` composes the precomputed aggregate tables
# (``budget_aggregates`` + the bucket/category/monthly child tables +
# ``recurring_charges``) into the design §3 shape. No recompute happens here —
# both backends serve thin reads of those tables (DA-23).
#
# Wire conventions (Appendix A): money is a fixed-2dp decimal STRING; percentages
# are JSON NUMBERS on a 0-100 scale (one decimal by convention, DA-22); dates are
# ``YYYY-MM-DD``; months are ``YYYY-MM``.


def _money_str(value: Decimal) -> str:
    """Render money as a fixed-2dp decimal string (Appendix A / DA-2)."""
    return f"{value:.2f}"


def _percent_num(value: Decimal) -> float:
    """Render a percentage as a JSON number, 0-100, one decimal (DA-22).

    The DB stores the column as ``NUMERIC`` (a ``Decimal`` 0-100). We quantize to
    one decimal place and emit a float so the wire form is a JSON number that
    matches the NestJS ``Number(value.toFixed(1))`` exactly.
    """
    return float(value.quantize(Decimal("0.1")))


class BudgetBucket(BaseModel):
    """One 50/30/20 bucket row (``/budget.buckets[]``)."""

    name: Bucket
    target_pct: Decimal
    actual_pct: Decimal
    amount: Decimal

    @field_serializer("target_pct", "actual_pct")
    def _serialize_pct(self, value: Decimal) -> float:
        return _percent_num(value)

    @field_serializer("amount")
    def _serialize_amount(self, value: Decimal) -> str:
        return _money_str(value)


class BudgetCategory(BaseModel):
    """One category breakdown row (``/budget.categories[]``)."""

    name: str
    amount: Decimal
    bucket: Bucket

    @field_serializer("amount")
    def _serialize_amount(self, value: Decimal) -> str:
        return _money_str(value)


class MonthlyNeedsWants(BaseModel):
    """One month of needs/wants totals (``/budget.monthly[]``)."""

    month: str  # YYYY-MM
    needs: Decimal
    wants: Decimal

    @field_serializer("needs", "wants")
    def _serialize_money(self, value: Decimal) -> str:
        return _money_str(value)


class RecurringChargeOut(BaseModel):
    """One detected recurring charge (``/budget.recurring[]``)."""

    merchant: str
    category: str
    cadence: str
    last_charged: date_cls
    monthly_est: Decimal

    @field_serializer("monthly_est")
    def _serialize_money(self, value: Decimal) -> str:
        return _money_str(value)


class Budget(BaseModel):
    """The full ``GET /api/v1/budget`` response (design §3).

    Scalars (``savings_rate``, ``effective_tax_rate``) are numeric percentages;
    the arrays compose the precomputed child tables. Empty DB -> well-formed
    zeros (rates ``0``) and empty arrays.
    """

    savings_rate: Decimal
    effective_tax_rate: Decimal
    buckets: list[BudgetBucket]
    categories: list[BudgetCategory]
    monthly: list[MonthlyNeedsWants]
    recurring: list[RecurringChargeOut]

    @field_serializer("savings_rate", "effective_tax_rate")
    def _serialize_pct(self, value: Decimal) -> float:
        return _percent_num(value)


# --- Net Worth view (P4.3) -------------------------------------------------
#
# ``GET /api/v1/networth`` composes the ``accounts`` table into the design §3
# shape. A thin read (DA-23 spirit): NO recompute, NO synthesized history. Both
# backends read the SAME ``accounts`` rows, so for the same DB state FastAPI and
# NestJS return byte-identical bodies (DA-9).
#
# Composition (deterministic, derived only from ``accounts.balance``):
#   * ``assets``      = sum of POSITIVE balances;
#   * ``liabilities`` = absolute sum of NEGATIVE balances (money-out convention);
#   * ``net_worth``   = assets - liabilities = sum of ALL balances.
# A null balance counts as 0.
#
# ``accounts[]`` lists every account (sorted by name, then id) with its balance.
# ``delta_30d`` is ``"0.00"`` for every account: the snapshot ``accounts`` table
# carries no balance history, so there is no 30-day change to report yet (a
# clock-derived value would break cross-backend parity). For the same reason
# ``series[]`` (monthly retirement/investments/cash history) is EMPTY until a
# history source exists — neither backend fabricates it. Empty DB -> all-zero
# totals + empty arrays. Wire conventions (Appendix A): money is a fixed-2dp
# decimal STRING; months are ``YYYY-MM``.


class NetWorthSeriesPoint(BaseModel):
    """One monthly net-worth series point (``/networth.series[]``)."""

    month: str  # YYYY-MM
    retirement: Decimal
    investments: Decimal
    cash: Decimal

    @field_serializer("retirement", "investments", "cash")
    def _serialize_money(self, value: Decimal) -> str:
        return _money_str(value)


class NetWorthAccount(BaseModel):
    """One per-account balance row (``/networth.accounts[]``)."""

    name: str
    type: str
    balance: Decimal
    delta_30d: Decimal

    @field_serializer("balance", "delta_30d")
    def _serialize_money(self, value: Decimal) -> str:
        return _money_str(value)


class NetWorth(BaseModel):
    """The full ``GET /api/v1/networth`` response (design §3).

    Totals (``net_worth``, ``assets``, ``liabilities``) are money decimal
    strings. Empty DB -> all-zero totals and empty ``series``/``accounts``.
    """

    net_worth: Decimal
    assets: Decimal
    liabilities: Decimal
    series: list[NetWorthSeriesPoint]
    accounts: list[NetWorthAccount]

    @field_serializer("net_worth", "assets", "liabilities")
    def _serialize_money(self, value: Decimal) -> str:
        return _money_str(value)


# --- Investments view (P4.4) -----------------------------------------------
#
# ``GET /api/v1/investments`` is a THIN read of the ``holdings`` table (design
# §3). No analytics are recomputed: the portfolio totals and the allocation /
# concentration percentages are simple deterministic aggregations of the stored
# holding rows, computed IDENTICALLY in both backends so for the same DB state
# FastAPI and NestJS return byte-identical bodies (DA-9).
#
# Wire conventions (Appendix A): market values (``portfolio_value``,
# ``unrealized_gain``, allocation ``amount``, holding ``value``/``gain``) are
# fixed-2dp decimal STRINGS (DA-2); allocation/concentration/holding
# percentages are JSON NUMBERS on a 0-100 scale (DA-22).


class Allocation(BaseModel):
    """One asset-class allocation row (``/investments.allocation[]``).

    ``actual_pct`` is the asset class's share of ``portfolio_value`` (its
    market-value weight); ``target_pct`` is the sum of the class's stored
    per-holding ``weight`` values (the intended/target allocation). ``amount``
    is the class's total market value. The wire field is ``class`` (a Python
    keyword), so the attribute is ``class_`` with a serialization alias.
    """

    model_config = ConfigDict(populate_by_name=True)

    class_: str = Field(serialization_alias="class")
    target_pct: Decimal
    actual_pct: Decimal
    amount: Decimal

    @field_serializer("target_pct", "actual_pct")
    def _serialize_pct(self, value: Decimal) -> float:
        return _percent_num(value)

    @field_serializer("amount")
    def _serialize_amount(self, value: Decimal) -> str:
        return _money_str(value)


class Concentration(BaseModel):
    """One per-holding concentration row (``/investments.concentration[]``).

    ``weight`` is the holding's share of ``portfolio_value`` (market-value
    weight), so the concentration list ranks single-position risk.
    """

    holding: str
    weight: Decimal

    @field_serializer("weight")
    def _serialize_pct(self, value: Decimal) -> float:
        return _percent_num(value)


class Holding(BaseModel):
    """One investment holding row (``/investments.holdings[]``).

    ``weight`` is the stored per-holding weight column (the holding's intended
    portfolio weight); ``value`` and ``gain`` are money decimal strings.
    """

    symbol: str
    name: str
    value: Decimal
    weight: Decimal
    gain: Decimal

    @field_serializer("value", "gain")
    def _serialize_money(self, value: Decimal) -> str:
        return _money_str(value)

    @field_serializer("weight")
    def _serialize_pct(self, value: Decimal) -> float:
        return _percent_num(value)


class Investments(BaseModel):
    """The full ``GET /api/v1/investments`` response (design §3).

    ``portfolio_value`` and ``unrealized_gain`` are money decimal strings; the
    arrays are deterministic aggregations of the ``holdings`` table. Empty DB ->
    ``"0.00"`` totals and empty arrays.
    """

    portfolio_value: Decimal
    unrealized_gain: Decimal
    allocation: list[Allocation]
    concentration: list[Concentration]
    holdings: list[Holding]

    @field_serializer("portfolio_value", "unrealized_gain")
    def _serialize_money(self, value: Decimal) -> str:
        return _money_str(value)
