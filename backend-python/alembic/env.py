"""Alembic environment.

The database URL is resolved at runtime from ``app.config.get_settings()`` (not
hardcoded in ``alembic.ini``), normalized to the psycopg v3 driver, and
``target_metadata`` is ``app.db.Base.metadata`` so future autogenerate works.
No revisions exist yet (schema lands in P2.1), so ``alembic upgrade head`` is a
no-op.
"""

from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context
from app.db import Base, _normalize_url
from app.config import get_settings

# Alembic Config object (access to alembic.ini values).
config = context.config

# Resolve the DB URL from app settings; keep secrets out of alembic.ini.
config.set_main_option("sqlalchemy.url", _normalize_url(get_settings().database_url))

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Metadata target for 'autogenerate' (empty until P2.1 adds ORM models).
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (URL only, no Engine/DBAPI)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode (create an Engine and connect)."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
