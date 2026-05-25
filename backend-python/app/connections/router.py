"""Connections API router (P6.1) — parity twin of the NestJS connections module.

Routes (canonical contract; identical path/method/body/status in both backends):

* ``POST /api/v1/connections/link-token`` -> create a Plaid Link token.
* ``POST /api/v1/connections/exchange``   -> exchange public_token, ENCRYPT +
  store the access_token, return ``{item_id, status}`` (token never returned).
* ``GET  /api/v1/connections``            -> per-source ``{source, mode, status}``
  + linked Items.
* ``POST /api/v1/connections/webhook``    -> JWT/JWKS-verified Plaid webhook;
  unverified/forged/unsigned -> canonical 401; body schema-validated -> 422.

Plus an OAuth redirect route (``GET /api/v1/connections/oauth``) with a strict
redirect-URI allowlist (NO open redirect). It is excluded from the OpenAPI
schema (it is not part of the frozen canonical contract).

The Plaid client, JWKS cache, and rate limiter are dependency-injected so tests
substitute fakes and CI stays hermetic (no network). No token/secret is ever
logged (DA-14).
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.connections.plaid_gateway import PlaidGateway, SdkPlaidGateway
from app.connections.redaction import safe_log
from app.connections.schemas import (
    Acknowledgement,
    ConnectionsList,
    ExchangeRequest,
    ExchangeResponse,
    LinkTokenCreateRequest,
    LinkTokenResponse,
    WebhookRequest,
)
from app.connections.service import (
    list_connections,
    parse_allowlist,
    resolve_redirect,
    store_exchanged_item,
)
from app.connections.webhook import JwksCache, RateLimiter, verify_webhook
from app.db import get_db
from app.errors import ServiceUnavailableError, UnauthorizedError

router = APIRouter(prefix="/api/v1/connections", tags=["connections"])

# Default products a Link session requests when the body omits them.
DEFAULT_PRODUCTS = ["transactions", "liabilities"]


@lru_cache
def _default_gateway() -> PlaidGateway:
    """Build the Plaid gateway once (overridable in tests via DI).

    ``PLAID_FAKE=1`` selects the network-free fake gateway (the parity harness /
    CI set it so no real Plaid call is made); otherwise the real SDK gateway.
    """
    import os

    if os.environ.get("PLAID_FAKE") == "1":
        from app.connections.fake_gateway import FakePlaidGateway

        return FakePlaidGateway()
    settings = get_settings()
    return SdkPlaidGateway(settings.plaid_client_id, settings.plaid_secret, settings.plaid_env)


def get_gateway() -> PlaidGateway:
    """DI seam for the Plaid gateway (override in tests)."""
    return _default_gateway()


@lru_cache
def _jwks_cache() -> JwksCache:
    return JwksCache(get_gateway())


def get_jwks_cache() -> JwksCache:
    """DI seam for the JWKS cache (override in tests)."""
    return _jwks_cache()


_RATE_LIMITER = RateLimiter()


def get_rate_limiter() -> RateLimiter:
    """DI seam for the webhook rate limiter (override in tests)."""
    return _RATE_LIMITER


GatewayDep = Annotated[PlaidGateway, Depends(get_gateway)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
DbDep = Annotated[Session, Depends(get_db)]


@router.post("/link-token", response_model=LinkTokenResponse, summary="Create a Plaid Link token.")
def create_link_token(
    gateway: GatewayDep,
    settings: SettingsDep,
    body: LinkTokenCreateRequest | None = None,
) -> LinkTokenResponse:
    """Create a short-lived Plaid Link token for the browser widget."""
    products = (
        [str(p.value) for p in body.products]
        if body is not None and body.products
        else DEFAULT_PRODUCTS
    )
    try:
        link = gateway.create_link_token(
            products, webhook=settings.plaid_webhook_url, user_id=settings.plaid_user_id
        )
    except Exception as exc:  # Plaid/network failure -> degraded 503 (DA-18).
        safe_log("link_token_error", products=products)
        raise ServiceUnavailableError("Plaid is unavailable.") from exc
    safe_log("link_token_created", products=products)
    return LinkTokenResponse(link_token=link.link_token, expiration=link.expiration)


@router.post(
    "/exchange",
    response_model=ExchangeResponse,
    summary="Exchange a public_token; access_token is encrypted and never returned.",
)
def exchange(
    body: ExchangeRequest,
    gateway: GatewayDep,
    settings: SettingsDep,
    db: DbDep,
) -> ExchangeResponse:
    """Exchange the public_token, ENCRYPT the access_token, and store the Item."""
    try:
        result = gateway.exchange_public_token(body.public_token)
    except Exception as exc:
        safe_log("exchange_error")
        raise ServiceUnavailableError("Plaid is unavailable.") from exc
    status = store_exchanged_item(
        db,
        item_id=result.item_id,
        access_token=result.access_token,
        user_id=settings.plaid_user_id,
        app_encryption_key=settings.app_encryption_key,
        products=DEFAULT_PRODUCTS,
    )
    safe_log("item_linked", item_id=result.item_id, status=status)
    return ExchangeResponse(item_id=result.item_id, status=status)


@router.get("", response_model=ConnectionsList, summary="List linked Items and per-source state.")
def get_connections(db: DbDep) -> ConnectionsList:
    """Return the connections snapshot the Settings screen renders."""
    return list_connections(db)


@router.post(
    "/webhook",
    response_model=Acknowledgement,
    summary="Plaid webhook receiver; JWT/JWKS-verified, unverified -> 401.",
)
async def webhook(
    request: Request,
    jwks: Annotated[JwksCache, Depends(get_jwks_cache)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
) -> Acknowledgement:
    """Verify the Plaid webhook (DA-11), validate its body, and acknowledge."""
    if not limiter.allow():
        # Rate-limited callers are treated as unverified (canonical 401).
        raise UnauthorizedError("Too many webhook attempts.")

    raw_body = await request.body()
    verify_webhook(raw_body, request.headers.get("plaid-verification"), jwks)

    # Body schema validation AFTER verification (canonical 422 on bad shape).
    import json

    from fastapi.exceptions import RequestValidationError
    from pydantic import ValidationError

    try:
        payload = json.loads(raw_body or b"{}")
    except json.JSONDecodeError as exc:
        raise UnauthorizedError() from exc
    try:
        parsed = WebhookRequest.model_validate(payload)
    except ValidationError as exc:
        # Route the model error through the canonical 422 handler (DA-1).
        raise RequestValidationError(exc.errors()) from exc
    safe_log(
        "webhook_received",
        webhook_type=parsed.webhook_type,
        webhook_code=parsed.webhook_code,
        item_id=parsed.item_id,
    )
    return Acknowledgement(status="accepted")


@router.get("/oauth", include_in_schema=False)
def oauth_redirect(redirect_uri: str, settings: SettingsDep) -> Response:
    """OAuth return route. Redirects ONLY to an allowlisted URI (no open redirect)."""
    allowlist = parse_allowlist(settings.oauth_redirect_allowlist)
    try:
        target = resolve_redirect(redirect_uri, allowlist)
    except ValueError as exc:
        # Reject a non-allowlisted URI as a validation failure (canonical 422).
        from app.errors import CODE_VALIDATION, HTTP_422_VALIDATION, _envelope
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=HTTP_422_VALIDATION,
            content=_envelope(
                CODE_VALIDATION,
                "Request validation failed.",
                [
                    {
                        "field": "redirect_uri",
                        "location": "query",
                        "message": str(exc),
                        "code": "value_error",
                    }
                ],
            ),
        )
    safe_log("oauth_redirect")
    return Response(status_code=307, headers={"location": target})
