"""Connections business logic (P6.1) — backend-neutral, parity twin of NestJS.

Pure-ish functions the router calls, kept free of FastAPI specifics so they are
unit-testable and mirror the NestJS service 1:1:

* :func:`list_connections` — read ``plaid_items`` + ``source_config`` and build the
  ``{items, sources}`` snapshot the Settings screen consumes.
* :func:`store_exchanged_item` — encrypt the access_token (DA-12) and UPSERT the
  Item row; the token is written ONLY as ciphertext.
* :func:`resolve_redirect` — enforce the OAuth redirect-URI allowlist (NO open
  redirect): an exact, case-sensitive match against the configured allowlist.

The mapping from a Plaid product to our source families is centralized in
:data:`PRODUCT_TO_SOURCES` so both backends classify identically.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.connections.crypto import encrypt_token
from app.connections.schemas import (
    ConnectionItem,
    ConnectionsList,
    SourceConnection,
)
from app.errors import ServiceUnavailableError
from app.models import SOURCE_VALUES, PlaidItem, SourceConfig

# Which source families each Plaid product feeds (lower_snake, Appendix A).
PRODUCT_TO_SOURCES: dict[str, list[str]] = {
    "transactions": ["transactions"],
    "liabilities": ["loans"],
    "investments": ["holdings"],
    "income": ["income"],
}


def sources_for_products(products: list[str] | None) -> list[str]:
    """Map an Item's products to the sorted, de-duplicated sources it feeds."""
    out: set[str] = set()
    for product in products or []:
        out.update(PRODUCT_TO_SOURCES.get(product, []))
    return sorted(out)


def store_exchanged_item(
    db: Session,
    *,
    item_id: str,
    access_token: str,
    user_id: str,
    app_encryption_key: str,
    institution: str | None = None,
    products: list[str] | None = None,
) -> str:
    """Encrypt + UPSERT a linked Item; return its lifecycle status.

    The access_token is encrypted to ``nonce||ciphertext||tag`` bytes and stored
    in the ``BYTEA`` column — never as plaintext. Re-linking the same ``item_id``
    updates the row (idempotent).
    """
    ciphertext = encrypt_token(access_token, app_encryption_key)
    now = datetime.now(timezone.utc)
    try:
        existing = db.scalar(select(PlaidItem).where(PlaidItem.item_id == item_id))
        if existing is None:
            db.add(
                PlaidItem(
                    user_id=user_id,
                    item_id=item_id,
                    access_token=ciphertext,
                    institution=institution,
                    products=products,
                    status="connected",
                    created_at=now,
                    updated_at=now,
                )
            )
        else:
            existing.access_token = ciphertext
            existing.institution = institution
            existing.products = products
            existing.status = "connected"
            existing.updated_at = now
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise ServiceUnavailableError() from exc
    return "connected"


def list_connections(db: Session) -> ConnectionsList:
    """Build the connections snapshot from ``plaid_items`` + ``source_config``."""
    try:
        items = list(db.scalars(select(PlaidItem).order_by(PlaidItem.item_id)))
        configs = {c.source: c for c in db.scalars(select(SourceConfig))}
    except SQLAlchemyError as exc:
        raise ServiceUnavailableError() from exc

    connection_items: list[ConnectionItem] = []
    # Per-source status: a source is "connected" iff a connected Item feeds it.
    connected_sources: set[str] = set()
    for item in items:
        item_sources = sources_for_products(item.products)
        if item.status == "connected":
            connected_sources.update(item_sources)
        connection_items.append(
            ConnectionItem(
                item_id=item.item_id,
                institution=item.institution or "",
                products=list(item.products or []),
                status=item.status,
                sources=item_sources,
                last_synced=item.updated_at,
            )
        )

    sources: list[SourceConnection] = []
    for source in SOURCE_VALUES:
        cfg = configs.get(source)
        mode = cfg.mode if cfg is not None else "local"
        status = "connected" if source in connected_sources else "not_connected"
        sources.append(SourceConnection(source=source, mode=mode, status=status))

    return ConnectionsList(items=connection_items, sources=sources)


def parse_allowlist(raw: str) -> list[str]:
    """Parse the comma-separated OAuth redirect allowlist into exact URIs."""
    return [uri.strip() for uri in raw.split(",") if uri.strip()]


def resolve_redirect(redirect_uri: str, allowlist: list[str]) -> str:
    """Return ``redirect_uri`` IFF it exactly matches an allowlisted URI.

    NO open redirect (DA): an exact, case-sensitive whole-string match — no
    prefix/substring/startswith logic. A non-allowlisted URI raises ``ValueError``
    so the router renders a canonical 422.
    """
    if redirect_uri in allowlist:
        return redirect_uri
    raise ValueError("redirect_uri is not on the allowlist.")
