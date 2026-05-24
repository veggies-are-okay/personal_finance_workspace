"""Tests for ``app.db`` wiring (no live database is contacted)."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.db import Base, SessionLocal, _normalize_url, engine, get_db


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (
            "postgresql://pf:pf@localhost:5432/personal_finance",
            "postgresql+psycopg://pf:pf@localhost:5432/personal_finance",
        ),
        (
            "postgresql+psycopg://pf:pf@localhost:5432/db",
            "postgresql+psycopg://pf:pf@localhost:5432/db",
        ),
        ("sqlite:///:memory:", "sqlite:///:memory:"),
    ],
)
def test_normalize_url(raw: str, expected: str) -> None:
    assert _normalize_url(raw) == expected


def test_engine_uses_psycopg_driver() -> None:
    # Engine constructs without connecting; URL must carry the psycopg3 driver.
    assert engine.url.drivername == "postgresql+psycopg"


def test_base_metadata_is_empty_for_now() -> None:
    # Schema lands in P2.1; no tables registered yet.
    assert Base.metadata.tables == {}


def test_get_db_yields_and_closes_session() -> None:
    gen = get_db()
    session = next(gen)
    assert isinstance(session, Session)
    # Exhausting the generator triggers the finally: close().
    with pytest.raises(StopIteration):
        next(gen)


def test_session_local_is_bound_to_engine() -> None:
    session = SessionLocal()
    try:
        assert session.bind is engine
    finally:
        session.close()
