"""Canonical cross-backend error envelope + FastAPI exception handlers.

Both backends emit ONE error shape (Appendix A / DA-1)::

    {"error": {"code": str, "message": str,
               "details": [{"field", "location", "message", "code"}]}}

FastAPI's default request-validation response is HTTP 422 with a
``{"detail": [...]}`` body; NestJS's ``ValidationPipe`` defaults to HTTP 400
with ``{statusCode, message[], error}``. Neither matches the canonical shape,
so both backends override their defaults. This module is the FastAPI half:

* ``VALIDATION_ERROR`` -> **422** (we keep FastAPI's status; NestJS moves to 422).
* ``SERVICE_UNAVAILABLE`` -> **503** when the backing store is unavailable
  (DA-18); raised as :class:`ServiceUnavailableError` and handled here.

The handlers are registered by :func:`register_exception_handlers` so every
router (P4.1 transactions and the later view endpoints) inherits the same shape.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Canonical HTTP statuses (literals avoid the starlette constant deprecation churn).
HTTP_422_VALIDATION = 422
HTTP_503_UNAVAILABLE = 503

# Stable machine codes shared with backend-ts (keep values byte-identical).
CODE_VALIDATION = "VALIDATION_ERROR"
CODE_NOT_FOUND = "NOT_FOUND"
CODE_CONFLICT = "CONFLICT"
CODE_UNAUTHORIZED = "UNAUTHORIZED"
CODE_SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"


class ErrorDetail(BaseModel):
    """One field-level validation problem (canonical ``details[]`` element)."""

    field: str
    location: str
    message: str
    code: str


class ErrorBody(BaseModel):
    """The inner ``error`` object of the canonical envelope."""

    code: str
    message: str
    details: list[ErrorDetail]


class Error(BaseModel):
    """The ONE canonical error envelope (shapes the OpenAPI ``Error`` schema)."""

    error: ErrorBody


class ServiceUnavailableError(Exception):
    """Raised when the backing store is unavailable / not ready (-> 503, DA-18).

    Routes catch DB connectivity failures (``OperationalError`` etc.) and raise
    this so the canonical 503 body is produced in one place, identical to the
    NestJS filter's 503 branch.
    """

    def __init__(self, message: str = "Database unavailable.") -> None:
        super().__init__(message)
        self.message = message


def _envelope(
    code: str, message: str, details: list[dict[str, str]] | None = None
) -> dict[str, Any]:
    """Build the canonical error body as a plain dict (ready for ``JSONResponse``)."""
    return {"error": {"code": code, "message": message, "details": details or []}}


def _location_of(loc: tuple[Any, ...]) -> tuple[str, str]:
    """Split a Pydantic ``loc`` into (location, field).

    Pydantic ``loc`` for a query param looks like ``("query", "limit")``. The
    first element is the request part (``query``/``body``/``path``); the rest is
    the dotted field path. When there is no field segment we fall back to the
    location itself (matches NestJS, which reports the property name).
    """
    if not loc:
        return ("query", "")
    location = str(loc[0])
    field_parts = [str(p) for p in loc[1:]]
    field = ".".join(field_parts) if field_parts else location
    return (location, field)


def _details_from_validation(exc: RequestValidationError) -> list[dict[str, str]]:
    """Map FastAPI/Pydantic validation errors onto canonical ``details[]``."""
    details: list[dict[str, str]] = []
    for err in exc.errors():
        location, field = _location_of(tuple(err.get("loc", ())))
        details.append(
            {
                "field": field,
                "location": location,
                "message": str(err.get("msg", "")),
                "code": str(err.get("type", "")),
            }
        )
    return details


async def validation_exception_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Override FastAPI's default 422 body with the canonical envelope (DA-1)."""
    return JSONResponse(
        status_code=HTTP_422_VALIDATION,
        content=_envelope(
            CODE_VALIDATION,
            "Request validation failed.",
            _details_from_validation(exc),
        ),
    )


async def service_unavailable_handler(
    _request: Request, exc: ServiceUnavailableError
) -> JSONResponse:
    """Emit the canonical 503 body when the backing store is unavailable (DA-18)."""
    return JSONResponse(
        status_code=HTTP_503_UNAVAILABLE,
        content=_envelope(CODE_SERVICE_UNAVAILABLE, exc.message, []),
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Wire the canonical handlers onto the app (called by ``create_app``)."""
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(ServiceUnavailableError, service_unavailable_handler)
