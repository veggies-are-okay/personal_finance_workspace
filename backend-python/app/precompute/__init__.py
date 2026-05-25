"""Deterministic analytics precompute (P3.2) — Python only.

Reads ``transactions`` (+ ``paystubs`` income) and writes the precomputed
``budget_aggregates`` + ``budget_{bucket,category,monthly}_aggregates`` +
``recurring_charges`` tables that the ``/api/v1/budget`` view endpoint serves as
thin reads. **No categorization logic lives in TypeScript** (spec §5): both
backends later just READ these tables, which keeps FastAPI↔NestJS parity trivial
(DA-9).

The categorization keyword rules here are **generic** (common merchant/category
patterns) — they intentionally do NOT reproduce the owner's real merchant lists.

Public API:

* :func:`run_precompute` — the orchestrator: enrich transactions, detect
  recurring series, and write every aggregate table for one ``window``.
* The pure helpers (:func:`categorize`, :func:`is_transfer`,
  :func:`detect_recurring`, :func:`compute_rates`) are exported for golden-fixture
  tests that assert exact values (DA-9).
"""

from app.precompute.categorize import (
    BUCKET_FOR_CATEGORY,
    bucket_for_category,
    categorize,
    is_transfer,
)
from app.precompute.pipeline import PrecomputeResult, run_precompute
from app.precompute.rates import compute_rates
from app.precompute.recurring import RecurringSeries, detect_recurring

__all__ = [
    "BUCKET_FOR_CATEGORY",
    "PrecomputeResult",
    "RecurringSeries",
    "bucket_for_category",
    "categorize",
    "compute_rates",
    "detect_recurring",
    "is_transfer",
    "run_precompute",
]
