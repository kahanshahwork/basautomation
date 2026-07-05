"""
core/db.py — Single source of truth for persistence (PostgreSQL).

Touch this file ONLY when changing table schema or adding a new table.
Every other module talks to the DB through get_db() + plain SQL — no ORM.

── Why the shim ──────────────────────────────────────────────────────────────
The whole codebase was written against SQLite's API: `conn.execute("... ?", args)`,
`cursor.lastrowid`, `conn.executescript(...)`, `sqlite3.Row` dict-style rows, and
`PRAGMA` calls. Rather than rewrite ~190 call sites, this module wraps psycopg
(PostgreSQL) in a thin compatibility layer that speaks the same API:

  • `?` placeholders are auto-translated to `%s`
  • `.lastrowid` works (INSERTs get a `RETURNING id` appended automatically)
  • rows behave like sqlite3.Row: both `row["col"]` and `row[0]` work, dict(row) works
  • `executescript()` runs multi-statement SQL
  • `PRAGMA ...` calls are accepted and ignored (Postgres has no PRAGMA)

So the rest of the app is unchanged; only the connection layer differs.
"""

import os
import re
import threading

import psycopg
from psycopg.rows import dict_row

# ── Connection settings (env-driven; sensible local defaults) ────────────────
# In Docker these come from docker-compose. Locally you can export them or rely
# on defaults matching a standard local Postgres.
DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = os.environ.get("DB_PORT", "5432")
DB_NAME = os.environ.get("DB_NAME", "docparse")
DB_USER = os.environ.get("DB_USER", "docparse")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "docparse")

_CONNINFO = f"host={DB_HOST} port={DB_PORT} dbname={DB_NAME} user={DB_USER} password={DB_PASSWORD}"

_local = threading.local()


# ── Row that behaves like sqlite3.Row (index AND key access, dict()-able) ────
class Row(dict):
    """A dict that also supports positional access row[0] and is falsy-safe."""
    def __init__(self, mapping, order):
        super().__init__(mapping)
        self._order = order

    def __getitem__(self, k):
        if isinstance(k, int):
            return super().__getitem__(self._order[k])
        return super().__getitem__(k)

    def keys(self):
        return list(self._order)


class _Cursor:
    """Wraps a psycopg cursor to accept `?` placeholders and expose .lastrowid."""

    def __init__(self, raw):
        self._raw = raw
        self.lastrowid = None

    @staticmethod
    def _translate(sql: str) -> str:
        # `?` -> `%s` (our SQL never puts ? inside string literals, so this is safe).
        sql = sql.replace("?", "%s")
        # SQLite's datetime('now') -> Postgres now()
        sql = sql.replace("datetime('now')", "now()")
        return sql

    # Tables whose primary key is NOT a column named "id" — the shim must not
    # append "RETURNING id" for these (there's no id column to return).
    _NO_ID_TABLES = ("temp_files",)

    def execute(self, sql, params=()):
        sql_t = self._translate(sql)
        low = sql_t.lstrip().lower()

        # Auto-RETURNING id for INSERTs so .lastrowid works like SQLite —
        # but only for tables that actually have an "id" column.
        want_lastrowid = (
            low.startswith("insert into")
            and "returning" not in low
            and not any(f"insert into {t}" in low for t in self._NO_ID_TABLES)
        )
        if want_lastrowid:
            sql_t = sql_t.rstrip().rstrip(";") + " RETURNING id"

        self._raw.execute(sql_t, params or ())

        if want_lastrowid:
            try:
                got = self._raw.fetchone()
                if got is not None:
                    self.lastrowid = got["id"] if isinstance(got, dict) else got[0]
            except Exception:
                self.lastrowid = None
        return self

    def executemany(self, sql, seq_of_params):
        sql_t = self._translate(sql)
        self._raw.executemany(sql_t, list(seq_of_params))
        return self

    def _wrap(self, row):
        if row is None:
            return None
        order = list(row.keys())
        return Row(row, order)

    def fetchone(self):
        return self._wrap(self._raw.fetchone())

    def fetchall(self):
        return [self._wrap(r) for r in self._raw.fetchall()]

    @property
    def rowcount(self):
        return self._raw.rowcount

    def close(self):
        self._raw.close()


class _Conn:
    """Wraps a psycopg connection to mimic the sqlite3.Connection API we use."""

    def __init__(self, raw):
        self._raw = raw

    def execute(self, sql, params=()):
        cur = _Cursor(self._raw.cursor(row_factory=dict_row))
        low = sql.lstrip().lower()
        # Accept and ignore SQLite PRAGMAs.
        if low.startswith("pragma"):
            return _EmptyCursor()
        return cur.execute(sql, params)

    def executemany(self, sql, seq_of_params):
        cur = _Cursor(self._raw.cursor(row_factory=dict_row))
        return cur.executemany(sql, seq_of_params)

    def executescript(self, script: str):
        # psycopg can execute multiple ; -separated statements in one call.
        with self._raw.cursor() as c:
            c.execute(script)
        return self

    def commit(self):
        self._raw.commit()

    def rollback(self):
        self._raw.rollback()

    def cursor(self):
        return _Cursor(self._raw.cursor(row_factory=dict_row))


class _EmptyCursor:
    lastrowid = None
    rowcount = 0
    def fetchone(self): return None
    def fetchall(self): return []
    def execute(self, *a, **k): return self


def get_db() -> _Conn:
    """Thread-local wrapped connection (mirrors the old SQLite get_db)."""
    conn = getattr(_local, "conn", None)
    if conn is not None:
        # psycopg connections can go bad; check and recreate if needed.
        try:
            if conn._raw.closed:
                conn = None
        except Exception:
            conn = None
    if conn is None:
        raw = psycopg.connect(_CONNINFO, autocommit=False)
        _local.conn = _Conn(raw)
    return _local.conn


# ── Schema (PostgreSQL) ──────────────────────────────────────────────────────
SCHEMA = """
CREATE TABLE IF NOT EXISTS advisors (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    firm       TEXT,
    email      TEXT,
    created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients (
    id            SERIAL PRIMARY KEY,
    advisor_id    INTEGER REFERENCES advisors(id),
    name          TEXT NOT NULL,
    business_type TEXT NOT NULL DEFAULT 'RETAIL_TRADING',
    created_at    TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quarters (
    id           SERIAL PRIMARY KEY,
    client_id    INTEGER NOT NULL REFERENCES clients(id),
    year         TEXT,
    label        TEXT NOT NULL,
    period_start TEXT,
    period_end   TEXT,
    created_at   TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS statements (
    id             SERIAL PRIMARY KEY,
    quarter_id     INTEGER REFERENCES quarters(id),
    bank_id        TEXT NOT NULL,
    filename       TEXT,
    statement_name TEXT,
    status         TEXT NOT NULL DEFAULT 'parsed',
    uploaded_by    TEXT,
    created_at     TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
    id             SERIAL PRIMARY KEY,
    code           TEXT UNIQUE NOT NULL,
    name           TEXT NOT NULL,
    pnl_group      TEXT NOT NULL,
    gst_applicable INTEGER NOT NULL DEFAULT 0,
    gst_rate       REAL NOT NULL DEFAULT 0.10,
    bas_label      TEXT,
    is_active      INTEGER NOT NULL DEFAULT 1,
    is_new         INTEGER NOT NULL DEFAULT 0,
    sort_order     INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
    id             SERIAL PRIMARY KEY,
    statement_id   INTEGER NOT NULL REFERENCES statements(id),
    transaction_id TEXT,
    date           TEXT,
    description    TEXT,
    amount         REAL NOT NULL,
    balance        REAL,
    source_page    INTEGER,
    row_top        REAL,
    confidence     REAL,
    approved       INTEGER NOT NULL DEFAULT 0,
    category_id    INTEGER REFERENCES categories(id),
    gst_amount     REAL DEFAULT 0,
    net_amount     REAL,
    group_key      TEXT,
    created_at     TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendor_memory (
    id          SERIAL PRIMARY KEY,
    client_id   INTEGER REFERENCES clients(id),
    pattern     TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    hit_count   INTEGER NOT NULL DEFAULT 1,
    updated_at  TIMESTAMP DEFAULT now(),
    UNIQUE(client_id, pattern)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id          SERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id   INTEGER NOT NULL,
    action      TEXT NOT NULL,
    detail      TEXT,
    actor       TEXT,
    created_at  TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_usage_log (
    id                 SERIAL PRIMARY KEY,
    statement_id       INTEGER,
    prompt_tokens      INTEGER,
    completion_tokens  INTEGER,
    total_tokens       INTEGER,
    limit_requests     INTEGER,
    remaining_requests INTEGER,
    limit_tokens       INTEGER,
    remaining_tokens   INTEGER,
    created_at         TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quarter_consolidations (
    id                 SERIAL PRIMARY KEY,
    quarter_id         INTEGER NOT NULL REFERENCES quarters(id),
    consolidation_name TEXT NOT NULL DEFAULT 'Consolidated Report',
    data               TEXT,
    created_at         TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS annual_consolidations (
    id          SERIAL PRIMARY KEY,
    client_id   INTEGER NOT NULL REFERENCES clients(id),
    label       TEXT NOT NULL,
    quarter_ids TEXT NOT NULL,
    data        TEXT,
    created_at  TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS temp_files (
    token      TEXT PRIMARY KEY,
    path       TEXT NOT NULL,
    expires    DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP DEFAULT now()
);
"""


def init_db():
    """Create tables if missing. Safe to call on every startup AND from multiple
    gunicorn workers at once — a Postgres advisory lock serializes schema creation
    so concurrent workers don't collide on CREATE TABLE."""
    conn = get_db()
    # Serialize across workers/processes: only one runs the schema block at a time.
    conn.execute("SELECT pg_advisory_lock(727351)")
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    except Exception:
        conn.rollback()
        # Another worker created the schema between our check and now — that's fine.
    finally:
        conn.execute("SELECT pg_advisory_unlock(727351)")
        conn.commit()


def log_audit(entity_type: str, entity_id: int, action: str, detail: str = "", actor: str = "user"):
    conn = get_db()
    conn.execute(
        "INSERT INTO audit_log (entity_type, entity_id, action, detail, actor) VALUES (?,?,?,?,?)",
        (entity_type, entity_id, action, detail, actor),
    )
    conn.commit()
