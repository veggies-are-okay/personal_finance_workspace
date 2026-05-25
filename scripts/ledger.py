"""Thin CLI wrapper: re-exports the canonical ledger normalizer from ``app``.

The pure normalization logic now lives at
``backend-python/app/ingestion/normalize_ledger.py`` so the FastAPI ingest
endpoints and the Docker image (which copies only ``app/``) can run it (P8.1).
This module stays as the repo-root CLI entry point and keeps the root project's
tests (``tests/test_ledger.py``) green by re-exporting every public name —
``import ledger`` continues to expose ``normalize_amex``, ``load_ledger``,
``parse_amount``, ``LedgerEntry``, ``REPO_ROOT``, ``DEFAULT_*``, etc.

Run::

    uv run python scripts/ledger.py
    uv run python scripts/ledger.py --out docs/bank_statements/ledger.csv
"""

from __future__ import annotations

import sys
from pathlib import Path

# Put backend-python/ on the path so ``app`` imports resolve when this script is
# run from the repo-root uv project (mirrors load_local.py's sys.path insert).
_BACKEND_PY = Path(__file__).resolve().parent.parent / "backend-python"
if str(_BACKEND_PY) not in sys.path:
    sys.path.insert(0, str(_BACKEND_PY))

from app.ingestion.normalize_ledger import (  # noqa: E402
    CSV_HEADER,
    DEFAULT_AMEX,
    DEFAULT_CHASE,
    DEFAULT_CHECKING,
    DEFAULT_DATA_DIR,
    DEFAULT_ELAN,
    DEFAULT_OUT_CSV,
    REPO_ROOT,
    LedgerEntry,
    load_ledger,
    main,
    normalize_amex,
    normalize_chase,
    normalize_checking,
    normalize_elan,
    parse_amount,
    write_csv,
)

__all__ = [
    "CSV_HEADER",
    "DEFAULT_AMEX",
    "DEFAULT_CHASE",
    "DEFAULT_CHECKING",
    "DEFAULT_DATA_DIR",
    "DEFAULT_ELAN",
    "DEFAULT_OUT_CSV",
    "REPO_ROOT",
    "LedgerEntry",
    "load_ledger",
    "main",
    "normalize_amex",
    "normalize_chase",
    "normalize_checking",
    "normalize_elan",
    "parse_amount",
    "write_csv",
]


if __name__ == "__main__":
    raise SystemExit(main())
