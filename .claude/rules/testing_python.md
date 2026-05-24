---
paths:
  - "backend-python/**/*.py"
  - "tests/**/*.py"
---

# Testing — Python (red-green-refactor, 80% coverage)

## Philosophy

1. **Red**: Write a failing test for the desired behavior.
2. **Green**: Implement the minimal code to make the test pass.
3. **Refactor**: Clean up without changing behavior; re-run tests.

- Test **behavior and contracts**, not incidental implementation details.
- Every feature or fix must **change tests** or explicitly document why none are needed.
- Run `uv run pytest` (and coverage) before considering work done. Do not mark implementation complete until tests pass and coverage meets the target.

---

## Test taxonomy (this repo)

| Scope | What it covers | Where it runs |
|-------|----------------|---------------|
| **Unit** | Pure logic, model validation, transform helpers, parser edge-cases, Decimal arithmetic | `uv run pytest` (local, mocks only) |
| **Integration** | FastAPI app wiring, SQLAlchemy session/repository with a transactional test DB, ingestion pipeline end-to-end against synthetic fixtures | `uv run pytest` (local, mocks only or disposable test DB) |
| **E2E** | Full flow against a real dev database (optional, run manually) | Runbook/script; not part of the normal pytest quality gate |

- **Unit tests must never call a real database or network.** Mock all DB sessions and HTTP clients at the use-site.
- E2E tests are **environment validation**; they do not replace unit/integration tests.

---

## Synthetic fixtures — never use real financial data

**Never commit or use real bank/credit-card data in tests.** All fixtures must be synthetic:

- Store small synthetic CSV or PDF-like text fixtures under `tests/fixtures/`.
- Fabricate realistic but entirely fictional merchants, amounts, and dates.
- The strongest invariant for ingestion tests: **sum of parsed purchases equals the statement's printed total** — the same check `scripts/extract_chase_statements.py` performs against its `Purchases +$...` summary line.

```python
# Good: invariant assertion on a synthetic fixture
def test_extracted_purchases_match_summary(synthetic_statement_path):
    txns, summary_total = parse_statement(synthetic_statement_path)
    assert summary_total is not None
    extracted = sum((t.amount for t in txns), Decimal("0"))
    assert extracted == summary_total  # exact Decimal comparison
```

---

## Coverage

- **Hard floor:** 80% across `backend-python/` (enforced by `--cov-fail-under=80` in `pyproject.toml`).
- **Practical ideal:** Changed modules should usually reach **90%+** unless they are wrappers or generated code.
- Require explicit tests for **success**, **failure**, and **not-found** paths for every endpoint and repository method.

**Commands:**

```bash
uv run pytest
uv run pytest --cov=backend_python --cov-report=term-missing --cov-fail-under=80
```

---

## Money is `Decimal` — compare exactly

All monetary values use `decimal.Decimal`. **Never use `pytest.approx` for money.** Reserve `pytest.approx` for genuine floating-point intermediates (e.g. statistical computations).

```python
from decimal import Decimal

# Correct
assert transaction.amount == Decimal("45.09")

# Wrong — do not do this for money
assert transaction.amount == pytest.approx(45.09)
```

---

## Speed and flakiness

- **Slow tests run by default** so the default suite meets the 80% coverage target.
- **`--fast`** skips tests marked `@pytest.mark.slow`; use for quick local runs only (coverage may drop).
- If a "unit" test appears in the slow list, fix mocks first:

  ```bash
  uv run pytest --durations=10 --durations-min=1.0
  ```

- **Flakiness:** Use `pytest.approx()` only for genuine floats. Avoid `time.sleep()` in unit tests; mock time or use `pytest-asyncio` / `anyio` for async code.

---

## Pytest classes and fixtures

- **Prefer function-based tests** by default.
- Use **test classes** only to group closely related scenarios that share the same setup.
- **Do not use `__init__`** on `Test*` classes — pytest will not collect them. Use **fixture injection** or **`@pytest.fixture(autouse=True)`** for shared setup.

**Good: class with autouse fixture**

```python
class TestTransactionsEndpoint:
    @pytest.fixture(autouse=True)
    def _setup(self, client, fake_db_session):
        self.client = client
        self.db = fake_db_session

    def test_returns_200(self):
        r = self.client.get("/transactions")
        assert r.status_code == 200

    def test_missing_account_returns_422(self):
        r = self.client.get("/transactions", params={"account_id": ""})
        assert r.status_code == 422
```

**Bad: `__init__` on test class**

```python
class TestTransactionsEndpoint:
    def __init__(self):  # do not do this in pytest
        self.client = TestClient(app)
```

- **Shared fixtures** belong in `tests/conftest.py`. Use `monkeypatch` for env vars and simple attribute swaps; use `unittest.mock` for call assertions and `side_effect`.

---

## Patching and mocking

### Where to patch

Patch in the **namespace where the object is looked up** (the module that *uses* the dependency), not where it is defined.

- **Correct:** If `backend_python.repositories.transactions` does `from sqlalchemy.orm import Session` and then calls `session.execute(...)`, patch `backend_python.repositories.transactions.Session`.
- **Wrong:** Patching `sqlalchemy.orm.Session` globally can miss already-imported references.

### Prefer fixtures for mocks

- **Environment variables:** `monkeypatch.setenv` / `monkeypatch.delenv` in a fixture.
- **Database sessions:** Fixture that either (a) provides a transactional `Session` rolled back after each test, or (b) patches the session factory at the use-site with a `MagicMock`.
- **External HTTP (httpx):** Fixture that patches `httpx.AsyncClient.request` at the use-site.

### Example: env var fixture

```python
@pytest.fixture
def mock_db_url(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://test:test@localhost/testdb")

def test_uses_db_url(mock_db_url):
    from backend_python.db import get_engine
    engine = get_engine()
    assert "testdb" in str(engine.url)
```

### Example: transactional test session (prefer over full mock when possible)

```python
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from backend_python.db import Base

@pytest.fixture(scope="session")
def engine():
    e = create_engine("postgresql+psycopg://test:test@localhost/test_personal_finance")
    Base.metadata.create_all(e)
    yield e
    Base.metadata.drop_all(e)

@pytest.fixture
def db_session(engine):
    """Each test gets its own transaction, rolled back on teardown."""
    with engine.connect() as conn:
        tx = conn.begin()
        session = Session(bind=conn)
        yield session
        session.close()
        tx.rollback()
```

### Example: mock repository at the use-site

```python
from unittest.mock import MagicMock, patch
from decimal import Decimal

@pytest.fixture
def mock_txn_repo():
    repo = MagicMock()
    repo.list_by_account.return_value = [
        {"date": "2025-01-15", "description": "WHOLE FOODS", "amount": Decimal("42.00")}
    ]
    return repo

def test_list_transactions(mock_txn_repo):
    with patch("backend_python.services.transaction_service.TransactionRepository",
               return_value=mock_txn_repo):
        result = get_transactions(account_id="acc-1")
    assert len(result) == 1
    assert result[0]["amount"] == Decimal("42.00")
```

### Example: fallback path via `side_effect`

```python
with patch("backend_python.services.exchange_rate.httpx.AsyncClient") as mock_client:
    mock_client.return_value.__aenter__.return_value.get.side_effect = [
        httpx.TimeoutException("timeout"),
        MagicMock(json=lambda: {"rate": 1.35}, status_code=200),
    ]
    rate = await get_usd_to_cad()
assert rate == pytest.approx(1.35)  # float OK here — not money
```

### Example: monkeypatch with dotted path

```python
def test_config_path(monkeypatch):
    monkeypatch.setattr("backend_python.config.Path.home", lambda: Path("/tmp/fake"))
    cfg = load_config()
    assert "/tmp/fake" in str(cfg.data_dir)
```

---

## Stack-specific patterns

### FastAPI

- Use **dependency overrides** to inject mock repositories or services for endpoint tests.
- Build a `TestClient(app)` fixture; override `app.dependency_overrides` in tests that need different behavior (e.g. DB failure → 503).

```python
from fastapi.testclient import TestClient
from backend_python.main import app
from backend_python.dependencies import get_db

@pytest.fixture
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()

def test_get_transactions_returns_200(client):
    r = client.get("/transactions", params={"account_id": "acc-1"})
    assert r.status_code == 200
    assert isinstance(r.json(), list)

def test_invalid_account_id_returns_422(client):
    r = client.get("/transactions", params={"account_id": ""})
    assert r.status_code == 422

def test_unknown_account_returns_404(client):
    r = client.get("/transactions", params={"account_id": "does-not-exist"})
    assert r.status_code == 404
```

### SQLAlchemy 2.0

- Prefer a **transactional test session** (see fixture above) over mocking at the ORM level — it exercises real SQL while remaining isolated.
- Mock at the session/repository boundary **only** when the test is explicitly a unit test for a service that should not touch a database at all.
- Use `pytest-sqlalchemy` or a plain `Session` rolled back inside a transaction; avoid truncating tables between tests (slower and stateful).

### httpx (external API clients)

- Patch `httpx.AsyncClient` or `httpx.Client` at the module that uses them.
- Stub `.get()`, `.post()` with `MagicMock` or `respx` for richer request matching.
- Always test the **timeout / network-error fallback** path, not just the happy path.

### CSV / PDF statement ingestion parsers

- Test against **small synthetic fixtures** committed under `tests/fixtures/`.
- Key invariant: `sum(t.amount for t in txns) == summary_total` (exact `Decimal` comparison).
- Test edge cases deterministically: sub-dollar amounts (`.15`), year-boundary inference (Dec → Jan), refund rows (negative amounts), multi-page sections with page-header noise, foreign-currency continuation lines that carry no USD amount.

```python
@pytest.mark.parametrize("fixture_name,expected_total", [
    ("synthetic_jan_statement.txt", Decimal("1234.56")),
    ("synthetic_dec_jan_boundary.txt", Decimal("567.89")),
])
def test_parser_matches_summary(fixture_name, expected_total, fixtures_dir):
    txns, summary_total = parse_statement(fixtures_dir / fixture_name)
    assert summary_total == expected_total
    assert sum((t.amount for t in txns), Decimal("0")) == expected_total

def test_subdollar_amount_parsed(fixtures_dir):
    txns, _ = parse_statement(fixtures_dir / "synthetic_subdollar.txt")
    small = [t for t in txns if t.amount == Decimal("0.15")]
    assert small, "Sub-dollar amount must be parsed without leading zero"

def test_year_boundary_inference(fixtures_dir):
    txns, _ = parse_statement(fixtures_dir / "synthetic_dec_jan_boundary.txt")
    dec_years = {t.date.year for t in txns if t.date.month == 12}
    jan_years = {t.date.year for t in txns if t.date.month == 1}
    assert dec_years == {2025}
    assert jan_years == {2026}
```

---

## Decorators and markers

- **`@pytest.mark.slow`**: For tests that legitimately take 1–5+ seconds (e.g. real DB round-trips with `scope="session"` setup). They **run by default**; use `--fast` to skip.
- **`@pytest.mark.parametrize`**: Use for schema/model validation or multiple input/output pairs.

  ```python
  @pytest.mark.parametrize("amount_str,expected", [
      ("45.09", Decimal("45.09")),
      (".15", Decimal("0.15")),
      ("-12.00", Decimal("-12.00")),
      ("1,234.56", Decimal("1234.56")),
  ])
  def test_parse_amount(amount_str, expected):
      assert parse_amount(amount_str) == expected
  ```

- **`@pytest.mark.anyio`** or **`@pytest.mark.asyncio`**: When testing async endpoints or services; do not mock async with blocking sleeps.
- **`pytest.raises`**: For invalid payloads and validation errors.

  ```python
  with pytest.raises(ValueError, match="account_id required"):
      parse_transaction_request({"amount": "45.09"})
  ```

---

## Sniff-testing: slow or unmocked tests

- If a "unit" test appears in the slow list, fix mocks first:

  ```bash
  uv run pytest --durations=10 --durations-min=1.0
  ```

- Optional: `pytest-timeout` (`@pytest.mark.timeout(5)`) or `faulthandler_timeout` in `pyproject.toml` to catch accidental network usage.
- Optional config upgrades (backlog): `strict_markers = true`, `strict_config = true` in `[tool.pytest.ini_options]`.

---

## Layout

- `tests/` mirrors source layout where helpful; use `tests/conftest.py` for shared fixtures.
- Synthetic fixtures live under `tests/fixtures/` (never real financial data).
- One focused test file per module (e.g. `tests/test_transaction_service.py` for `backend_python/services/transaction_service.py`).

---

## References

- Pytest: https://docs.pytest.org/
- SQLAlchemy 2.0 testing: https://docs.sqlalchemy.org/en/20/orm/session_transaction.html
- FastAPI testing: https://fastapi.tiangolo.com/tutorial/testing/
