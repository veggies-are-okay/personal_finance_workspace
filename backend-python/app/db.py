"""SQLAlchemy 2.0 database wiring.

Provides the engine, a session factory, the declarative ``Base`` (whose
metadata Alembic targets), and a FastAPI ``get_db()`` dependency. The
``DATABASE_URL`` is normalized to use the psycopg v3 driver
(``postgresql+psycopg://``).
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


def _normalize_url(url: str) -> str:
    """Force the psycopg v3 driver for Postgres URLs.

    ``psycopg`` (v3) is the installed driver. A bare ``postgresql://`` URL
    resolves to psycopg2 under SQLAlchemy, which is not installed, so rewrite
    it to ``postgresql+psycopg://``. Non-Postgres URLs (e.g. SQLite in tests)
    are returned unchanged.
    """
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


class Base(DeclarativeBase):
    """Declarative base; ORM models inherit from this (schema lands in P2.1)."""


engine = create_engine(_normalize_url(get_settings().database_url))

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a session, closed after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
