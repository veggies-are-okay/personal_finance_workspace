"""Pydantic v2 response/request schemas (shape the OpenAPI contract)."""

from __future__ import annotations

from pydantic import BaseModel


class HealthResponse(BaseModel):
    """Canonical ``GET /health`` response body.

    Kept trivially identical across backends (see backend-ts parity twin):
    always ``{"status": "ok"}``. Does not depend on the database.
    """

    status: str
