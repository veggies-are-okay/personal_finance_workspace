"""Thin, injectable wrapper around the Plaid client (P6.1).

The router depends on the :class:`PlaidGateway` PROTOCOL, not the concrete SDK,
so tests substitute a fake (CI is hermetic — no network, DA). The real
implementation, :class:`SdkPlaidGateway`, adapts ``plaid.api.plaid_api.PlaidApi``.

Only the four calls the connections feature needs are exposed:
* ``create_link_token`` -> ``/link/token/create``
* ``exchange_public_token`` -> ``/item/public_token/exchange``
* ``get_webhook_verification_key`` -> ``/webhook_verification_key/get`` (JWKS)
* ``create_sandbox_public_token`` -> ``/sandbox/public_token/create`` (local proof)

No token value is ever logged here (DA-14).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol


@dataclass(frozen=True)
class LinkToken:
    """Result of a link-token creation."""

    link_token: str
    expiration: datetime


@dataclass(frozen=True)
class ExchangeResult:
    """Result of a public->access token exchange (access_token is secret)."""

    access_token: str
    item_id: str


class PlaidGateway(Protocol):
    """The Plaid surface the connections feature depends on (inject a fake in tests)."""

    def create_link_token(
        self, products: list[str], *, webhook: str, user_id: str
    ) -> LinkToken: ...

    def exchange_public_token(self, public_token: str) -> ExchangeResult: ...

    def get_webhook_verification_key(self, key_id: str) -> dict[str, Any]: ...

    def create_sandbox_public_token(
        self, institution_id: str, initial_products: list[str]
    ) -> str: ...


class SdkPlaidGateway:
    """Concrete gateway adapting the official ``plaid-python`` SDK."""

    def __init__(self, client_id: str, secret: str, env: str) -> None:
        import plaid
        from plaid.api import plaid_api

        host = {
            "sandbox": plaid.Environment.Sandbox,
            "production": plaid.Environment.Production,
        }.get(env, plaid.Environment.Sandbox)
        configuration = plaid.Configuration(
            host=host,
            api_key={"clientId": client_id, "secret": secret, "plaidVersion": "2020-09-14"},
        )
        self._client = plaid_api.PlaidApi(plaid.ApiClient(configuration))

    def create_link_token(self, products: list[str], *, webhook: str, user_id: str) -> LinkToken:
        from plaid.model.country_code import CountryCode
        from plaid.model.link_token_create_request import LinkTokenCreateRequest
        from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
        from plaid.model.products import Products

        request = LinkTokenCreateRequest(
            products=[Products(p) for p in products],
            client_name="Personal Finance",
            country_codes=[CountryCode("US")],
            language="en",
            user=LinkTokenCreateRequestUser(client_user_id=user_id),
            webhook=webhook,
        )
        response = self._client.link_token_create(request)
        return LinkToken(link_token=response["link_token"], expiration=response["expiration"])

    def exchange_public_token(self, public_token: str) -> ExchangeResult:
        from plaid.model.item_public_token_exchange_request import (
            ItemPublicTokenExchangeRequest,
        )

        response = self._client.item_public_token_exchange(
            ItemPublicTokenExchangeRequest(public_token=public_token)
        )
        return ExchangeResult(access_token=response["access_token"], item_id=response["item_id"])

    def get_webhook_verification_key(self, key_id: str) -> dict[str, Any]:
        from plaid.model.webhook_verification_key_get_request import (
            WebhookVerificationKeyGetRequest,
        )

        response = self._client.webhook_verification_key_get(
            WebhookVerificationKeyGetRequest(key_id=key_id)
        )
        return dict(response["key"])

    def create_sandbox_public_token(self, institution_id: str, initial_products: list[str]) -> str:
        from plaid.model.products import Products
        from plaid.model.sandbox_public_token_create_request import (
            SandboxPublicTokenCreateRequest,
        )

        response = self._client.sandbox_public_token_create(
            SandboxPublicTokenCreateRequest(
                institution_id=institution_id,
                initial_products=[Products(p) for p in initial_products],
            )
        )
        return response["public_token"]
