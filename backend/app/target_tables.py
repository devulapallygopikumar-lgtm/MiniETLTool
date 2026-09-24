"""Materializes a real, typed Postgres table per dataset from the rows a run
loads — instead of leaving `loaded_rows` as the only queryable copy (a
generic `(dataset_id, run_id, row_ordinal, data_json)` store).

This is the RDBMS target from ARCHITECTURE.md §4.2 ("For RDBMS targets,
`begin` creates a staging table... `commit` performs the atomic swap or
merge") scoped down for the slice: the table is created once per dataset,
named from `mapping.target_table`, with columns typed from the dataset's
already-pinned inferred schema (§4.4), and each successful run appends its
loaded rows into it. `loaded_rows` is untouched and keeps working as the
audit/fallback copy every run already wrote.

Values that don't parse to the target column type land as NULL — the same
thing that happens today if `type_parse` isn't mandatory on that column.
Enforce `type_parse` as mandatory on a column to guarantee its physical
column never loses data this way.
"""

import re
from datetime import date, datetime

from sqlalchemy import text as sa_text
from sqlalchemy.engine import Connection

from .readers.inference import _DATE_FORMATS

_PG_TYPES = {
    "integer": "BIGINT",
    "number": "NUMERIC",
    "date": "DATE",
    "string": "TEXT",
}

_RESERVED_COLUMNS = {"id", "run_id", "row_ordinal", "loaded_at"}


_MAX_TABLE_NAME = 63


def physical_table_name(dataset_id: str) -> str:
    return "dataset_" + dataset_id.replace("-", "_")


def slugify_identifier(name: str, fallback: str = "entity") -> str:
    """A Postgres-safe table name built from arbitrary user text -- used for
    a "processed into a new entity" dataset's table (routers/process.py),
    where the user names the table themselves instead of it being derived
    from the dataset id."""
    slug = re.sub(r"[^a-zA-Z0-9_]", "_", name.strip().lower())
    slug = re.sub(r"_+", "_", slug).strip("_")
    if not slug:
        slug = fallback
    if slug[0].isdigit():
        slug = f"t_{slug}"
    return slug[:_MAX_TABLE_NAME]


def unique_table_name(base: str, existing: set[str]) -> str:
    if base not in existing:
        return base
    i = 2
    while True:
        candidate = f"{base}_{i}"[:_MAX_TABLE_NAME]
        if candidate not in existing:
            return candidate
        i += 1


def _slug_column(name: str, used: set[str]) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_]", "_", name).strip("_").lower() or "col"
    if slug[0].isdigit():
        slug = f"c_{slug}"
    slug = slug[:57]
    if slug in _RESERVED_COLUMNS or slug in used:
        base, i = slug, 2
        while slug in _RESERVED_COLUMNS or slug in used:
            slug = f"{base}_{i}"
            i += 1
    used.add(slug)
    return slug


def build_column_map(columns: list[dict]) -> list[tuple[str, str, str]]:
    """Returns (source_column_name, physical_column_name, inferred_type) per column."""
    used: set[str] = set()
    return [(c["name"], _slug_column(c["name"], used), c["type"]) for c in columns]


def ensure_table(conn: Connection, table_name: str, columns: list[dict]) -> list[tuple[str, str, str]]:
    col_map = build_column_map(columns)
    cols_sql = ",\n  ".join(f'"{phys}" {_PG_TYPES.get(type_key, "TEXT")}' for _, phys, type_key in col_map)
    conn.execute(
        sa_text(
            f'CREATE TABLE IF NOT EXISTS "{table_name}" (\n'
            f"  id BIGSERIAL PRIMARY KEY,\n"
            f"  run_id VARCHAR(36) NOT NULL,\n"
            f"  row_ordinal INTEGER NOT NULL,\n"
            f"  {cols_sql},\n"
            f"  loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()\n"
            f")"
        )
    )

    # The table may already have existed with fewer/different columns --
    # a later run's transforms (rename/derive/cast/sequence/project) can
    # change the output schema at any time, and CREATE TABLE IF NOT
    # EXISTS above is then a no-op. Reconcile by adding whatever this
    # run's columns are missing; existing rows get NULL for a newly
    # added column, same as any other schema migration.
    existing = set(physical_columns(conn, table_name))
    for _, phys, type_key in col_map:
        if phys not in existing:
            conn.execute(sa_text(f'ALTER TABLE "{table_name}" ADD COLUMN "{phys}" {_PG_TYPES.get(type_key, "TEXT")}'))

    return col_map


def physical_columns(conn: Connection, table_name: str) -> list[str]:
    """The real, current data columns of an already-materialized typed
    table, in physical order -- excludes the bookkeeping columns every
    such table also has (id/run_id/row_ordinal/loaded_at). Unlike a
    dataset's pinned columns_json (set once at discovery), this reflects
    whatever a run's transforms actually produced (rename/derive/
    sequence/project all change the shape) -- see app/derived.py, which
    needs the real thing to let a "process into a new entity" op
    reference a transform-derived column."""
    rows = conn.execute(
        sa_text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = :t ORDER BY ordinal_position"
        ),
        {"t": table_name},
    ).all()
    return [r[0] for r in rows if r[0] not in _RESERVED_COLUMNS]


def _cast_value(value: str | None, type_key: str) -> object:
    if value is None:
        return None
    try:
        if type_key == "integer":
            return int(value)
        if type_key == "number":
            return float(value)
        if type_key == "date":
            for fmt in _DATE_FORMATS:
                try:
                    return datetime.strptime(value, fmt).date()
                except ValueError:
                    continue
            return None
        return value
    except ValueError:
        return None


def insert_rows(
    conn: Connection,
    table_name: str,
    run_id: str,
    rows: list[dict[str, str | None]],
    row_ordinals: list[int],
    col_map: list[tuple[str, str, str]],
) -> None:
    # Each successful run replaces this dataset's typed table with its own
    # batch -- the table has a 1:1 owning dataset (via mapping.target_table),
    # so this can't touch another dataset's rows. Without this, a second
    # run just appends: previews, exports and every Process Data op reading
    # this table would silently double up (or worse) on every re-run.
    # loaded_rows is untouched and keeps every run's rows for audit --
    # this table's job is "current queryable state", not history.
    conn.execute(sa_text(f'TRUNCATE TABLE "{table_name}"'))
    if not rows:
        return
    phys_cols = [phys for _, phys, _ in col_map]
    col_list = ", ".join(f'"{phys}"' for phys in phys_cols)
    placeholders = ", ".join(f":{phys}" for phys in phys_cols)
    stmt = sa_text(
        f'INSERT INTO "{table_name}" (run_id, row_ordinal, {col_list}) '
        f"VALUES (:run_id, :row_ordinal, {placeholders})"
    )
    params = []
    for ordinal, row in zip(row_ordinals, rows):
        p: dict[str, object] = {"run_id": run_id, "row_ordinal": ordinal}
        for source, phys, type_key in col_map:
            p[phys] = _cast_value(row.get(source), type_key)
        params.append(p)
    conn.execute(stmt, params)
