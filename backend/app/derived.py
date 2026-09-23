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
from sqlalchemy.orm import Session

from . import models, target_tables

_AGG_FUNCS = {"sum", "avg", "count", "min", "max"}
_WINDOW_FUNCS = {"row_number", "rank", "dense_rank", "sum", "avg", "count", "min", "max"}


def _dataset(db: Session, dataset_id: str) -> models.Dataset:
    dataset = db.get(models.Dataset, dataset_id)
    if dataset is None:
        raise ValueError(f"Dataset {dataset_id} not found")
    return dataset


def _col_map(dataset: models.Dataset) -> dict[str, str]:
    """logical column name -> unquoted physical column name in the typed table."""
    return {name: phys for name, phys, _ in target_tables.build_column_map(dataset.columns_json)}


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
    cols = _col_map(source)
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
        right = _dataset(db, args["right_dataset_id"])
        right_cols = _col_map(right)
        right_table = _q(_table(right))
        return _join_sql(table, cols, right_table, right_cols, args)
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
    left_table: str,
    left_cols: dict[str, str],
    right_table: str,
    right_cols: dict[str, str],
    args: dict,
) -> tuple[str, list[str]]:
    join_type = str(args.get("join_type", "inner")).upper()
    if join_type not in ("INNER", "LEFT", "RIGHT", "FULL"):
        raise ValueError(f"Unsupported join type: {join_type}")
    left_key = _require(left_cols, args["left_key"])
    right_key = _require(right_cols, args["right_key"])
    left_prefix = args.get("left_prefix", "l_")
    right_prefix = args.get("right_prefix", "r_")

    select_parts = [f"l.{_q(p)} AS {_q(left_prefix + name)}" for name, p in left_cols.items()]
    select_parts += [f"r.{_q(p)} AS {_q(right_prefix + name)}" for name, p in right_cols.items()]
    output = [left_prefix + n for n in left_cols] + [right_prefix + n for n in right_cols]

    sql = (
        f"SELECT {', '.join(select_parts)} FROM {left_table} l "
        f"{join_type} JOIN {right_table} r ON l.{_q(left_key)} = r.{_q(right_key)}"
    )
    return sql, output


def execute_rows(db: Session, spec: dict) -> list[dict[str, str | None]]:
    sql, columns = build_sql(db, spec)
    result = db.execute(sa_text(sql))
    rows: list[dict[str, str | None]] = []
    for record in result.mappings():
        rows.append({name: (str(record[name]) if record[name] is not None else None) for name in columns})
    return rows
