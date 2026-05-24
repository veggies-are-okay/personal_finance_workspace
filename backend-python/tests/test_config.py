"""Tests for ``app.config`` settings and defaults."""

from __future__ import annotations

from app.config import Settings, get_settings


def test_default_settings() -> None:
    # Construct directly without reading the optional .env so defaults are tested.
    settings = Settings(_env_file=None)
    assert settings.app_name == "personal-finance-api"
    assert settings.database_url == "postgresql://pf:pf@localhost:5432/personal_finance"


def test_env_var_overrides_default(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@db:5432/other")
    settings = Settings(_env_file=None)
    assert settings.database_url == "postgresql://u:p@db:5432/other"


def test_get_settings_is_cached() -> None:
    assert get_settings() is get_settings()
