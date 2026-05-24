"""Shared pytest fixtures for backend-python tests.

No fixture here touches a live database or network (see
``.claude/rules/testing_python.md``). The ``/health`` endpoint is
DB-independent, so the ``TestClient`` exercises it without any DB.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> Iterator[TestClient]:
    """A ``TestClient`` bound to the FastAPI app, with overrides cleared."""
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
