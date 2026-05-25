"""Response schemas for the Python-only ingest endpoints (P8.1).

These are NOT part of the 1:1 read-parity contract (ingestion is Python-owned;
see ``.claude/rules/backend-parity.md``), so they live alongside the ingestion
code rather than in ``app/schemas.py``. The shapes are still small and stable:
one ``IngestSummary`` per upload, listing the per-file detection result and the
total rows loaded.
"""

from __future__ import annotations

from pydantic import BaseModel


class IngestedFile(BaseModel):
    """Per-file result within an ingest summary."""

    filename: str
    detected_type: str
    rows: int


class IngestSummary(BaseModel):
    """Result of one ``POST /api/v1/ingest/{source}`` upload."""

    source: str
    files: list[IngestedFile]
    total_rows: int
