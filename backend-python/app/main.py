"""FastAPI application factory and routes.

Exposes the canonical ``GET /health`` endpoint (200, ``{"status": "ok"}``),
which is intentionally DB-independent so it stays identical across both
backends (see ``.claude/rules/backend-parity.md``).
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.schemas import HealthResponse

# Frontend dev origins (Vite). CORS is wired now so later UI work just works.
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    settings = get_settings()
    app = FastAPI(title=settings.app_name)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", response_model=HealthResponse, status_code=200)
    def health() -> HealthResponse:
        """Liveness probe. Always ``{"status": "ok"}``; never touches the DB."""
        return HealthResponse(status="ok")

    return app


app = create_app()
