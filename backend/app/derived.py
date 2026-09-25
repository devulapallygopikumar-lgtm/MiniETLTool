"""Executes a "process into a new entity" operation (ARCHITECTURE.md §5.3's
blocking operators: sort, group-by/aggregate, join, dedupe/distinct,
window functions, pivot/unpivot) as one SQL statement against source
datasets' already-materialized typed tables.

This is deliberately *not* part of the row-level Transform stage
(app/transforms.py). Those ops change a dataset's own loaded rows in
place; these change row cardinality or need a second dataset as input,
which would break the one-staged-row-in, one-loaded-row-out assumption
everything else (staging, validation, row_ordinal, the typed table) is
built on. Instead, the *result* of one of these ops becomes a brand-new
dataset -- its own id, own schema, own typed table -- created the same
way a discovered dataset is (see routers/process.py), and then run
through the exact same pipeline (rules, transforms, load) as any other.
A mapping with source_format 'derived' is how runner.py recognizes one:
instead of reading rows from a file, it calls execute_rows() here.

Every op reads real Postgres tables and lets Postgres do what it's
already good at (sorting, grouping, joins, window functions) rather than
reimplementing them over in-memory Python lists.
"""

from sqlalchemy import text as sa_text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from . import models, target_tables

_AGG_FUNCS = {"sum", "avg", "count", "min", "max"}
_WINDOW_FUNCS = {"row_number", "rank", "dense_rank", "sum", "avg", "count", "min", "max"}

# A join whose key isn't unique on the right side can fan out
# multiplicatively -- LIMIT bounds how many *rows* come back, but even
# just counting or scanning to the Nth row of a truly extreme fan-out
# (millions x millions) can itself run long. Bound the query outright
# rather than let a bad key choice hang the request indefinitely.
_STATEMENT_TIMEOUT_SECONDS = 15


def _run_bounded(db: Session, sql: str):
    """Runs one query with a hard server-side time limit, converting a
    timeout into the same ValueError -> 422 path every other bad-spec
    error in this module already takes (see routers/process.py)."""
    db.execute(sa_text(f"SET LOCAL statement_timeout = '{_STATEMENT_TIMEOUT_SECONDS}s'"))
    try:
        return db.execute(sa_text(sql))
    except DBAPIError as exc:
        db.rollback()
        raise ValueError(
            "This produces too many rows to compute here -- check that your "
            "join keys are actually unique on at least one side (a join "
            "keyed on a non-unique column on both sides can multiply rows "
            "rather than just add them)."
        ) from exc


def _dataset(db: Session, dataset_id: str) -> models.Dataset:
    dataset = db.get(models.Dataset, dataset_id)
    if dataset is None:
        raise ValueError(f"Dataset {dataset_id} not found")
    return dataset


def _col_map(db: Session, dataset: models.Dataset) -> dict[str, str]:
    """column name -> itself, from the typed table's real current columns
    -- not dataset.columns_json (the pinned discovery-time schema), which
    goes stale the moment a rename/derive/sequence/project transform runs
    (see target_tables.physical_columns)."""
    table = _table(dataset)
    return {c: c for c in target_tables.physical_columns(db.connection(), table)}


def _table(dataset: models.Dataset) -> str:
    return dataset.mapping.target_table


def _q(ident: str) -> str:
    return '"' + ident.replace('"', '""') + '"'


def _require(cols: dict[str, str], name: str) -> str:
    if name not in cols:
        raise ValueError(f"Column '{name}' does not exist on this dataset")
    return cols[name]


def build_sql(db: Session, spec: dict) -> tuple[str, list[str]]:
    """Returns (sql, output_column_names). Raises ValueError on a bad spec
    (missing column, unknown dataset, unsupported function) with a message
    safe to surface to the user."""
    op = spec.get("op")
    args = spec.get("args") or {}
    source = _dataset(db, spec["source_dataset_id"])
    cols = _col_map(db, source)
    table = _q(_table(source))

    if op == "sort":
        return _sort_sql(table, cols, args)
    if op == "dedupe":
        return _dedupe_sql(table, cols, args)
    if op == "group_by":
        return _group_by_sql(table, cols, args)
    if op == "window":
        return _window_sql(table, cols, args)
    if op == "pivot":
        return _pivot_sql(db, table, cols, args)
    if op == "unpivot":
        return _unpivot_sql(table, cols, args)
    if op == "join":
        return _join_sql(db, table, cols, args)
    raise ValueError(f"Unsupported operation: {op}")


def _select_all(table: str, cols: dict[str, str]) -> str:
    return ", ".join(f"{_q(phys)} AS {_q(name)}" for name, phys in cols.items())


def _sort_sql(table: str, cols: dict[str, str], args: dict) -> tuple[str, list[str]]:
    column = _require(cols, args["column"])
    direction = "DESC" if args.get("order") == "desc" else "ASC"
    sql = f"SELECT {_select_all(table, cols)} FROM {table} ORDER BY {_q(column)} {direction}"
    return sql, list(cols.keys())


def _dedupe_sql(table: str, cols: dict[str, str], args: dict) -> tuple[str, list[str]]:
    keys = args.get("columns") or []
    if not keys:
        raise ValueError("dedupe needs at least one column")
    key_phys = [_require(cols, c) for c in keys]
    key_list = ", ".join(_q(c) for c in key_phys)
    sql = f"SELECT DISTINCT ON ({key_list}) {_select_all(table, cols)} FROM {table} ORDER BY {key_list}"
    return sql, list(cols.keys())


def _group_by_sql(table: str, cols: dict[str, str], args: dict) -> tuple[str, list[str]]:
    group_by = args.get("group_by") or []
    aggregates = args.get("aggregates") or []
    if not group_by and not aggregates:
        raise ValueError("group_by needs at least one group-by column or aggregate")

    select_parts = []
    output: list[str] = []
    for name in group_by:
        phys = _require(cols, name)
        select_parts.append(f"{_q(phys)} AS {_q(name)}")
        output.append(name)

    for agg in aggregates:
        func = str(agg.get("function", "")).lower()
        if func not in _AGG_FUNCS:
            raise ValueError(f"Unsupported aggregate function: {func}")
        out_name = agg.get("as") or f"{func}_{agg.get('column', 'all')}"
        if func == "count" and not agg.get("column"):
            select_parts.append(f"COUNT(*) AS {_q(out_name)}")
        else:
            phys = _require(cols, agg["column"])
            select_parts.append(f"{func.upper()}({_q(phys)}) AS {_q(out_name)}")
        output.append(out_name)

    sql = f"SELECT {', '.join(select_parts)} FROM {table}"
    if group_by:
        group_phys = ", ".join(_q(_require(cols, c)) for c in group_by)
        sql += f" GROUP BY {group_phys}"
    return sql, output


def _window_sql(table: str, cols: dict[str, str], args: dict) -> tuple[str, list[str]]:
    func = str(args.get("function", "")).lower()
    if func not in _WINDOW_FUNCS:
        raise ValueError(f"Unsupported window function: {func}")
    partition_by = args.get("partition_by") or []
    order_by = args.get("order_by")
    out_name = args.get("as") or func

    if func in ("row_number", "rank", "dense_rank"):
        call = f"{func.upper()}()"
    else:
        column = _require(cols, args["column"])
        call = f"{func.upper()}({_q(column)})"

    over_parts = []
    if partition_by:
        part_phys = ", ".join(_q(_require(cols, c)) for c in partition_by)
        over_parts.append(f"PARTITION BY {part_phys}")
    if order_by:
        over_parts.append(f"ORDER BY {_q(_require(cols, order_by))}")
    over = f"OVER ({' '.join(over_parts)})" if over_parts else "OVER ()"

    select_cols = f"{_select_all(table, cols)}, {call} {over} AS {_q(out_name)}"
    sql = f"SELECT {select_cols} FROM {table}"
    return sql, [*cols.keys(), out_name]


def _pivot_sql(db: Session, table: str, cols: dict[str, str], args: dict) -> tuple[str, list[str]]:
    row_keys = args.get("row_keys") or []
    pivot_column = _require(cols, args["pivot_column"])
    value_column = _require(cols, args["value_column"])
    func = str(args.get("aggregate", "sum")).lower()
    if func not in _AGG_FUNCS:
        raise ValueError(f"Unsupported aggregate function: {func}")
    if not row_keys:
        raise ValueError("pivot needs at least one row-key column")

    # Postgres has no native PIVOT -- discover the distinct pivot values
    # first, then build one conditional-aggregation column per value.
    distinct_sql = sa_text(f"SELECT DISTINCT {_q(pivot_column)} FROM {table} ORDER BY 1 LIMIT 200")
    values = [row[0] for row in db.execute(distinct_sql).all() if row[0] is not None]
    if not values:
        raise ValueError("The pivot column has no non-null values to pivot on")

    row_key_phys = [_require(cols, c) for c in row_keys]
    select_parts = [f"{_q(p)} AS {_q(name)}" for name, p in zip(row_keys, row_key_phys)]
    output = list(row_keys)
    for value in values:
        out_name = str(value)
        # `value` came from a DISTINCT query against this same column, not
        # from user input -- safe to splice in as a literal.
        literal = "'" + str(value).replace("'", "''") + "'"
        when_clause = f"CASE WHEN {_q(pivot_column)} = {literal}"
        if func == "count":
            select_parts.append(f"COUNT({when_clause} THEN 1 END) AS {_q(out_name)}")
        else:
            select_parts.append(
                f"{func.upper()}({when_clause} THEN ({_q(value_column)})::numeric END) AS {_q(out_name)}"
            )
        output.append(out_name)

    group_phys = ", ".join(_q(p) for p in row_key_phys)
    sql = f"SELECT {', '.join(select_parts)} FROM {table} GROUP BY {group_phys}"
    return sql, output


def _unpivot_sql(table: str, cols: dict[str, str], args: dict) -> tuple[str, list[str]]:
    row_keys = args.get("row_keys") or []
    unpivot_columns = args.get("columns") or []
    category_name = args.get("category_name") or "category"
    value_name = args.get("value_name") or "value"
    if not unpivot_columns:
        raise ValueError("unpivot needs at least one column to unpivot")

    row_key_phys = [_require(cols, c) for c in row_keys]
    row_key_select = ", ".join(f"{_q(p)} AS {_q(name)}" for name, p in zip(row_keys, row_key_phys))
    branches = []
    for name in unpivot_columns:
        phys = _require(cols, name)
        prefix = f"{row_key_select}, " if row_key_select else ""
        branches.append(
            f"SELECT {prefix}'{name}' AS {_q(category_name)}, "
            f"{_q(phys)} AS {_q(value_name)} FROM {table}"
        )
    sql = " UNION ALL ".join(branches)
    return sql, [*row_keys, category_name, value_name]


def _join_sql(
    db: Session,
    left_table: str,
    left_cols: dict[str, str],
    args: dict,
) -> tuple[str, list[str]]:
    """A star join: the source table joined against one *or more* other
    datasets, each keyed against a column on the source (not against each
    other) -- e.g. a ledger_entries fact table joined to both ledgers and
    vouchers in one build. Each joined dataset gets its own join type and
    key pair, aliased r0, r1, ... in the generated SQL, and needs its own
    distinct output prefix so same-named columns across datasets (e.g.
    every Tally entity has a "guid") don't collide."""
    joins = args.get("joins")
    if not joins:
        raise ValueError("join needs at least one dataset to join with")

    left_prefix = args.get("left_prefix", "l_")
    select_parts = [f"l.{_q(p)} AS {_q(left_prefix + name)}" for name, p in left_cols.items()]
    output = [left_prefix + n for n in left_cols]
    join_clauses: list[str] = []
    prefixes_seen = {left_prefix}

    for i, j in enumerate(joins):
        join_type = str(j.get("join_type", "inner")).upper()
        if join_type not in ("INNER", "LEFT", "RIGHT", "FULL"):
            raise ValueError(f"Unsupported join type: {join_type}")
        right = _dataset(db, j["right_dataset_id"])
        right_cols = _col_map(db, right)
        right_table = _q(_table(right))
        left_key = _require(left_cols, j["left_key"])
        right_key = _require(right_cols, j["right_key"])
        right_prefix = j.get("right_prefix") or f"r{i}_"
        if right_prefix in prefixes_seen:
            raise ValueError(
                f"Prefix '{right_prefix}' is used by more than one joined dataset -- "
                "give each a distinct prefix"
            )
        prefixes_seen.add(right_prefix)

        alias = f"r{i}"
        select_parts += [f"{alias}.{_q(p)} AS {_q(right_prefix + name)}" for name, p in right_cols.items()]
        output += [right_prefix + n for n in right_cols]
        join_clauses.append(
            f"{join_type} JOIN {right_table} {alias} ON l.{_q(left_key)} = {alias}.{_q(right_key)}"
        )

    sql = f"SELECT {', '.join(select_parts)} FROM {left_table} l " + " ".join(join_clauses)
    return sql, output


def execute_rows(
    db: Session, spec: dict, limit: int | None = None
) -> list[dict[str, str | None]]:
    """`limit`, when given, is pushed into the SQL itself (not applied by
    slicing the Python result after the fact) -- a join whose key isn't
    unique on the right side can fan out multiplicatively, and this
    query already runs synchronously inside an HTTP request (schema
    inference at build time, /preview). Without a SQL-level limit that
    fan-out is a real way to hang the request: it's what building a two
    dataset join over ~40k rows did in testing, with no cap at all."""
    sql, columns = build_sql(db, spec)
    if limit is not None:
        # Bounded (schema-inference sample, /preview): a time limit too,
        # not just a row limit -- Postgres can usually short-circuit a
        # LIMIT through a join, but not always, and this path runs
        # synchronously inside an HTTP request. The unlimited path
        # (limit=None) is the real Run/load, an intentionally full,
        # background-task read that a legitimately large dataset can take
        # longer than this timeout to finish -- it must not be bounded.
        sql = f"SELECT * FROM ({sql}) t LIMIT {int(limit)}"
        result = _run_bounded(db, sql)
    else:
        result = db.execute(sa_text(sql))
    rows: list[dict[str, str | None]] = []
    for record in result.mappings():
        rows.append({name: (str(record[name]) if record[name] is not None else None) for name in columns})
    return rows


def count_rows(db: Session, spec: dict) -> int:
    """The *true* row count an op's spec produces, without pulling any of
    the actual row data into Python -- for a join, this still has to
    evaluate the full join server-side, but skips transferring and
    str()-converting every column of every row, which is the expensive
    part for a large fan-out. Time-bounded like the sampled path above,
    for the same reason (this also runs synchronously in a request)."""
    sql, _ = build_sql(db, spec)
    return _run_bounded(db, f"SELECT count(*) FROM ({sql}) t").scalar_one()
