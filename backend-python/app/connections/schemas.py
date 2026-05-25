"""Pydantic v2 request/response schemas for the connections API (P6.1).

These shape the OpenAPI for the four connections endpoints. The success-response
schemas must normalize identically to the canonical contract (and to the NestJS
DTOs) — the parity harness diffs all three structurally (DA-25). Appendix A wire
conventions:

* **Enums** (``Source``/``SourceMode``/``ItemStatus``) are lower_snake strings
  shared with the canonical registry and ``app.models``.
* **Datetimes** (``expiration``/``last_synced``) are ISO-8601 **UTC with a
  trailing Z** (Appendix A / DA-3), serialized via :func:`_iso_z`.
* **Null vs absent**: ``last_synced`` is optional and OMITTED when absent
  (``exclude_none``), never ``null`` — matches NestJS dropping ``undefined``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, WithJsonSchema, field_serializer

from app.models import (
    ITEM_STATUS_VALUES,
    SOURCE_MODE_VALUES,
    SOURCE_VALUES,
)

# Plaid products the Link widget may request (canonical LinkTokenCreateRequest).
PLAID_PRODUCTS = ("transactions", "liabilities", "investments", "income")


def _enum(name: str, values: tuple[str, ...]) -> type[Enum]:
    """Build a ``str, Enum`` from a registry tuple (value == name)."""
    return Enum(name, {v: v for v in values}, type=str)  # type: ignore[return-value]


Source = _enum("Source", SOURCE_VALUES)
SourceMode = _enum("SourceMode", SOURCE_MODE_VALUES)
ItemStatus = _enum("ItemStatus", ITEM_STATUS_VALUES)
PlaidProduct = _enum("PlaidProduct", PLAID_PRODUCTS)


def _iso_z(value: datetime) -> str:
    """Render a datetime as ISO-8601 UTC with a trailing ``Z`` (Appendix A).

    Naive datetimes are assumed UTC; aware datetimes are converted to UTC.
    Seconds precision (no microseconds) for a stable, byte-identical wire form.
    """
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --- POST /connections/link-token ------------------------------------------


class LinkTokenCreateRequest(BaseModel):
    """Optional body for link-token creation; ``products`` defaults server-side."""

    products: list[PlaidProduct] | None = None  # type: ignore[valid-type]


class LinkTokenResponse(BaseModel):
    """Short-lived Plaid Link token + its expiration."""

    link_token: str
    expiration: datetime

    @field_serializer("expiration")
    def _serialize_expiration(self, value: datetime) -> str:
        return _iso_z(value)


# --- POST /connections/exchange --------------------------------------------


class ExchangeRequest(BaseModel):
    """Exchange body: the Plaid ``public_token`` from the Link flow."""

    public_token: str


class ExchangeResponse(BaseModel):
    """Result of a successful exchange. The access_token is NEVER returned."""

    item_id: str
    status: ItemStatus  # type: ignore[valid-type]


# --- GET /connections ------------------------------------------------------


# An optional datetime that is OMITTED when absent (exclude_none). Without help
# Pydantic renders its OpenAPI as anyOf:[{date-time},{null}] (no top-level type),
# which the parity normalizer reduces to type:"unknown" — diverging from the
# canonical (and NestJS) type:"string". WithJsonSchema in SERIALIZATION mode forces
# the wire schema to a plain string so all three documents normalize identically.
_SerializedDateTime = Annotated[
    datetime,
    WithJsonSchema({"type": "string", "format": "date-time"}, mode="serialization"),
]


class ConnectionItem(BaseModel):
    """One linked Plaid Item with the sources it feeds."""

    model_config = ConfigDict(exclude_none=True)

    item_id: str
    institution: str
    products: list[PlaidProduct]  # type: ignore[valid-type]
    status: ItemStatus  # type: ignore[valid-type]
    sources: list[Source]  # type: ignore[valid-type]
    last_synced: _SerializedDateTime | None = None

    @field_serializer("last_synced", when_used="unless-none")
    def _serialize_last_synced(self, value: datetime) -> str:
        return _iso_z(value)


class SourceConnection(BaseModel):
    """Per-source mode + status (drives the Settings screen)."""

    source: Source  # type: ignore[valid-type]
    mode: SourceMode  # type: ignore[valid-type]
    status: ItemStatus  # type: ignore[valid-type]


class ConnectionsList(BaseModel):
    """The ``GET /api/v1/connections`` response: linked Items + per-source state."""

    items: list[ConnectionItem]
    sources: list[SourceConnection]


# --- POST /connections/webhook ---------------------------------------------


class WebhookRequest(BaseModel):
    """The verified webhook body (schema-validated after JWT verification)."""

    webhook_type: str
    webhook_code: str
    item_id: str | None = None


class Acknowledgement(BaseModel):
    """Canonical webhook accept body."""

    status: str
