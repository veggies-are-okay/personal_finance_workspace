"""FastAPI application factory and routes.

Exposes the canonical ``GET /health`` endpoint (200, ``{"status": "ok"}``),
which is intentionally DB-independent so it stays identical across both
backends (see ``.claude/rules/backend-parity.md``).
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.connections.router import router as connections_router
from app.errors import register_exception_handlers
from app.ingestion.router import router as ingest_router
from app.routers import budget, debt, goals, investments, networth, transactions
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

    # Canonical error envelope: validation -> 422, DB-unavailable -> 503 (DA-1/DA-18).
    register_exception_handlers(app)

    @app.get("/health", response_model=HealthResponse, status_code=200)
    def health() -> HealthResponse:
        """Liveness probe. Always ``{"status": "ok"}``; never touches the DB."""
        return HealthResponse(status="ok")

    # View endpoints (read precomputed/normalized tables; no recompute).
    app.include_router(transactions.router)
    app.include_router(budget.router)
    app.include_router(networth.router)
    app.include_router(investments.router)
    app.include_router(debt.router)
    app.include_router(goals.router)

    # Connections API (P6.1): Plaid link/exchange/list + JWT-verified webhook.
    app.include_router(connections_router)

    # Ingest API (P8.1): Python-OWNED upload/extract/load surface. Intentionally
    # NOT mirrored in backend-ts and excluded from the read-parity contract
    # (uses pdfplumber/PyYAML, like Alembic owns migrations) — see
    # .claude/rules/backend-parity.md. The parity harness ignores /ingest/*.
    app.include_router(ingest_router)

    return app


app = create_app()
