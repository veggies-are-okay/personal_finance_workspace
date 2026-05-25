"""Application settings via pydantic-settings.

Settings are read from environment variables, falling back to the repo-root
``.env`` file when present, then to the defaults defined here. The defaults are
chosen so the app works out of the box against the local docker-compose
Postgres without any ``.env`` file.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Repo root is two levels up from this file: backend-python/app/config.py.
_REPO_ROOT = Path(__file__).resolve().parents[2]
_ENV_FILE = _REPO_ROOT / ".env"


class Settings(BaseSettings):
    """Runtime configuration.

    Defaults match the local docker-compose Postgres (service ``pf_postgres``).
    """

    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "personal-finance-api"
    database_url: str = "postgresql://pf:pf@localhost:5432/personal_finance"

    # --- Plaid / connections (P6.1). Secrets come from the gitignored repo-root
    # `.env`; defaults keep the app bootable without them (CI mocks Plaid). The
    # single-user app keys every Item to one fixed user id. ---------------------
    plaid_client_id: str = ""
    plaid_secret: str = ""
    plaid_env: str = "sandbox"
    # base64 of 32 random bytes -> the AES-256-GCM key for token-at-rest (DA-12).
    app_encryption_key: str = ""
    plaid_user_id: str = "local"
    # Webhook URL Plaid calls back; only used to populate link/sandbox requests.
    plaid_webhook_url: str = "http://localhost:8000/api/v1/connections/webhook"
    # OAuth redirect allowlist (NO open redirect, DA): comma-separated exact URIs.
    oauth_redirect_allowlist: str = "http://localhost:5173/oauth,http://127.0.0.1:5173/oauth"


@lru_cache
def get_settings() -> Settings:
    """Return a cached ``Settings`` instance."""
    return Settings()
