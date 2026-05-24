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


@lru_cache
def get_settings() -> Settings:
    """Return a cached ``Settings`` instance."""
    return Settings()
