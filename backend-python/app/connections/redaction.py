"""Structured logging that NEVER emits secrets (DA-14).

Plaid ``access_token`` / ``public_token`` / ``link_token`` and any field whose
key looks token/secret-ish are scrubbed before anything is logged. The
connections code logs ONLY through :func:`safe_log`, so no token ever reaches a
log sink, a traceback, or an error body.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("app.connections")

REDACTED = "***REDACTED***"

# Substrings that mark a value as secret (case-insensitive). Keep broad.
_SECRET_MARKERS = (
    "access_token",
    "public_token",
    "link_token",
    "accesstoken",
    "publictoken",
    "linktoken",
    "secret",
    "authorization",
    "password",
    "client_secret",
    "plaid-verification",
)


def _is_secret_key(key: str) -> bool:
    lowered = key.lower()
    return any(marker in lowered for marker in _SECRET_MARKERS)


def redact(value: Any) -> Any:
    """Recursively redact secret-looking keys in dicts/lists; never mutates input."""
    if isinstance(value, dict):
        return {k: (REDACTED if _is_secret_key(str(k)) else redact(v)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    return value


def safe_log(event: str, **fields: Any) -> None:
    """Log a structured connections event with all secret-ish fields redacted."""
    logger.info("connections.%s %s", event, redact(fields))
