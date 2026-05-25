# backend-python (FastAPI) — multi-stage uv build.
#
# Stage 1 (builder): install the locked dependencies from pyproject.toml/uv.lock
# into a self-contained .venv. This project sets `[tool.uv] package = false`, so
# `app` is NOT an installed package — we install deps only and run from source.
#
# Stage 2 (runtime): a slim Python image carrying just the .venv plus the app
# source (app/, alembic/, alembic.ini). uvicorn binds 0.0.0.0:8000.
#
# Build context is backend-python/. The repo-root `.env` is NOT in this context
# and is never copied; runtime config (DATABASE_URL, PLAID_*, APP_ENCRYPTION_KEY)
# is injected via docker-compose `environment:`/`env_file:` and read by
# pydantic-settings from OS env (app/config.py tolerates a missing .env file).

FROM python:3.12-slim AS builder

# uv binary from the official distroless image (pinned major).
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /uvx /bin/

# Use the image's Python; never download a managed interpreter in the container.
ENV UV_PYTHON_DOWNLOADS=0 \
    UV_NO_DEV=1

WORKDIR /app

# Install dependencies in their own cached layer (no app source yet, no project),
# so dependency installs are not invalidated by source-only changes.
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project --no-dev

# ---- runtime ----
FROM python:3.12-slim

# Drop privileges: run as a non-root user.
RUN useradd --create-home --uid 10001 appuser

WORKDIR /app

# The venv from the builder; put it on PATH so `uvicorn`/`alembic` resolve.
COPY --from=builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# App source. alembic env.py imports `app.config`, so both app/ and alembic/
# must be present; the `migrate` one-shot runs `alembic upgrade head` from here.
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini ./alembic.ini

USER appuser

EXPOSE 8000

# 0.0.0.0 so the container is reachable from the compose network (the nginx
# frontend proxies /api/ here).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
