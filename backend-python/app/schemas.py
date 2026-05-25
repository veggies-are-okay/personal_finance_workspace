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


# --- Goals view (P4.6) -----------------------------------------------------
#
# ``GET /api/v1/goals`` is a THIN READ of the ``goals`` table (name, target,
# saved, progress_pct). The canonical contract (DA-25, frozen) returns ONE
# summary object: ``target`` + ``saved`` are the aggregate (sum across goals),
# ``progress_pct`` is the overall ratio, ``funding[]`` lists each goal as a
# funding source toward the aggregate, and ``affordability{}`` is a fixed-shape
# object. There is no ``funding``/``affordability`` table in the P2.3 schema, so
# ``affordability`` is served as well-formed zeros (and an empty DB yields zeros
# + an empty ``funding`` list). Both backends compose this identically from the
# SAME rows so the bodies are byte-identical (DA-9).
#
# Wire conventions (Appendix A): money is a fixed-2dp decimal STRING (DA-2);
# ``progress_pct``/``income_share`` are JSON NUMBERS on a 0-100 scale (DA-22).


class GoalFunding(BaseModel):
    """One funding source toward the goals total (``/goals.funding[]``).

    Composed from a ``goals`` row: ``source`` is the goal name, ``amount`` is its
    saved balance (a decimal string).
    """

    source: str
    amount: Decimal

    @field_serializer("amount")
    def _serialize_amount(self, value: Decimal) -> str:
        return _money_str(value)


class Affordability(BaseModel):
    """Home-affordability block (``/goals.affordability``).

    No backing table exists in the P2.3 schema, so every field is served as a
    well-formed zero. Money fields are decimal strings; ``income_share`` is a
    numeric percentage (0-100).
    """

    price: Decimal
    down_payment: Decimal
    mortgage: Decimal
    monthly_piti: Decimal
    income_share: Decimal

    @field_serializer("price", "down_payment", "mortgage", "monthly_piti")
    def _serialize_money(self, value: Decimal) -> str:
        return _money_str(value)

    @field_serializer("income_share")
    def _serialize_pct(self, value: Decimal) -> float:
        return _percent_num(value)


class Goals(BaseModel):
    """The full ``GET /api/v1/goals`` response (design §3).

    ``target``/``saved`` are decimal strings; ``progress_pct`` is a numeric
    percentage (0-100); ``funding`` lists each goal as a source; ``affordability``
    is the (zero-filled) home block. Empty DB -> ``target``/``saved`` ``"0.00"``,
    ``progress_pct`` ``0``, empty ``funding``, zero ``affordability``.
    """

    target: Decimal
    saved: Decimal
    progress_pct: Decimal
    funding: list[GoalFunding]
    affordability: Affordability

    @field_serializer("target", "saved")
    def _serialize_money(self, value: Decimal) -> str:
        return _money_str(value)

    @field_serializer("progress_pct")
    def _serialize_pct(self, value: Decimal) -> float:
        return _percent_num(value)
