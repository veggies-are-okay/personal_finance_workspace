"""Ingestion: write the normalized ledger into Postgres (P3.1).

The raw-statement → normalized-CSV **normalizers** live in the repo-root
``scripts/`` project (``scripts/ledger.py``). The **DB-writing loader** lives
here in ``backend-python/`` so it runs under the ``python-backend`` CI gate and
reuses ``app.models`` + ``app.db`` (SQLAlchemy 2.0). It consumes the canonical
signed-amount ledger and upserts it idempotently into ``transactions``.
"""
