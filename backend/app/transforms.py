"""The Transform stage (ARCHITECTURE.md §7.1's pipeline diagram, §5.3's
operator catalogue): runs on staged rows after the gate opens, before load.
Validation sees the *original* values -- a not_null rule on a column still
reports what was actually missing, even if a transform later fills it in
for the loaded copy.

Ten ops -- the half of §5.3's catalogue that doesn't change row
cardinality or need a second dataset merged row-for-row, so it fits the
existing one-staged-row-in, one-loaded-row-out pipeline without touching
how staging/validation/the typed table already work:

    filter    drop rows not matching an expression
    dedupe    drop rows repeating an earlier key (first occurrence kept)
    sort      reorder the surviving rows
    rename    rename a column
    lookup    enrich a row from another dataset's already-loaded rows
    derive    add a new column computed from an expression
    cast      reparse a column as a declared type (bad values -> null)
    mask      hash / redact / partial-mask a column
    fill_default  replace a null with a fixed value
    sequence  add a new column of sequential numbers, in final row order
    project   keep only a declared set of columns

Applied in a fixed phase order (not user-configurable per instance yet),
chosen so later phases can depend on earlier ones -- rename before
anything references the new name, project last so it can drop columns an
earlier derive only needed as scratch space:

    1 filter  2 dedupe  3 sort  4 rename  5 lookup  6 derive  7 cast
    8 mask  9 fill_default  10 sequence  11 project

Rows filter/dedupe remove don't vanish silently -- the caller (runner.py)
records them in rejected_rows with a reason, the same way an advisory
validation rule's reject_row does.

With no transforms configured (or only fill_default, the original single
op this module had), every phase here is a no-op and the output is
byte-for-byte what the pre-transform pipeline produced -- that's the
regression check this was built against.
"""

import hashlib
from dataclasses import dataclass

from .expressions import evaluate_row_expression, evaluate_row_value
from .readers.inference import parses_as

Row = dict[str, str | None]
IndexedRow = tuple[int, Row]


@dataclass
class TransformSpec:
    id: str
    column: str | None
    op: str
    args: dict


@dataclass
class TransformResult:
    rows: list[IndexedRow]
    dropped: list[tuple[int, Row, str]]  # (ordinal, original row, reason)
    columns: list[dict]  # output schema: [{name, type, nullable}, ...]


def lookup_sources(specs: list[TransformSpec]) -> set[str]:
    """Which other datasets a `lookup` transform needs loaded rows from,
    so the caller can fetch them before run_transforms needs them."""
    return {
        spec.args["source_dataset_id"]
        for spec in specs
        if spec.op == "lookup" and spec.args.get("source_dataset_id")
    }


def build_lookup_index(source_rows: list[Row], key_column: str) -> dict[str, Row]:
    index: dict[str, Row] = {}
    for row in source_rows:
        key = row.get(key_column)
        if key is not None and key not in index:  # first match wins, like a dedupe key
            index[key] = row
    return index


# ---- phase 1: filter ----


def _apply_filter(rows: list[IndexedRow], specs: list[TransformSpec]) -> tuple[list[IndexedRow], list[tuple[int, Row, str]]]:
    filter_specs = [s for s in specs if s.op == "filter"]
    if not filter_specs:
        return rows, []
    survivors: list[IndexedRow] = []
    dropped: list[tuple[int, Row, str]] = []
    for ordinal, row in rows:
        keep = all(evaluate_row_expression(s.args.get("expr", ""), row) for s in filter_specs)
        if keep:
            survivors.append((ordinal, row))
        else:
            dropped.append((ordinal, row, "excluded by filter transform"))
    return survivors, dropped


# ---- phase 2: dedupe ----


def _apply_dedupe(rows: list[IndexedRow], specs: list[TransformSpec]) -> tuple[list[IndexedRow], list[tuple[int, Row, str]]]:
    current = rows
    dropped: list[tuple[int, Row, str]] = []
    for spec in specs:
        if spec.op != "dedupe":
            continue
        cols = spec.args.get("columns") or ([spec.column] if spec.column else [])
        if not cols:
            continue
        seen: set[tuple] = set()
        next_current: list[IndexedRow] = []
        for ordinal, row in current:
            key = tuple(row.get(c) for c in cols)
            if key in seen:
                dropped.append((ordinal, row, f"duplicate on {', '.join(cols)} (dedupe transform)"))
            else:
                seen.add(key)
                next_current.append((ordinal, row))
        current = next_current
    return current, dropped


# ---- phase 3: sort ----


def _sort_key(value: str | None) -> tuple[int, float, str]:
    # A leading type discriminator keeps comparisons safe across rows even
    # if a column mixes numeric-looking and non-numeric values.
    if value is None:
        return (0, 0.0, "")
    try:
        return (1, float(value), "")
    except (TypeError, ValueError):
        return (2, 0.0, value)


def _apply_sort(rows: list[IndexedRow], specs: list[TransformSpec]) -> list[IndexedRow]:
    current = rows
    for spec in specs:
        if spec.op != "sort" or not spec.column:
            continue
        col = spec.column
        reverse = spec.args.get("order") == "desc"
        current = sorted(current, key=lambda item, c=col: _sort_key(item[1].get(c)), reverse=reverse)
    return current


# ---- phases 4-9: per-row column ops ----


def _mask_value(value: str | None, args: dict) -> str | None:
    if value is None:
        return None
    mode = args.get("mode", "redact")
    if mode == "hash":
        return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]
    if mode == "redact":
        return str(args.get("replacement", "***"))
    if mode == "partial":
        keep = max(0, int(args.get("keep", 4)))
        if len(value) <= keep:
            return "*" * len(value)
        return ("*" * (len(value) - keep)) + value[len(value) - keep :]
    return value


def _apply_column_ops(
    row: Row, specs: list[TransformSpec], lookup_indexes: dict[str, dict[str, Row]]
) -> Row:
    result = dict(row)

    for spec in specs:
        if spec.op == "rename" and spec.column:
            to = spec.args.get("to")
            if to and spec.column in result:
                result[to] = result.pop(spec.column)

    for spec in specs:
        if spec.op == "lookup":
            index = lookup_indexes.get(spec.id, {})
            match_col = spec.args.get("match_column")
            select = spec.args.get("select") or []
            prefix = spec.args.get("prefix", "")
            matched = index.get(result.get(match_col)) if match_col else None
            for col in select:
                result[f"{prefix}{col}"] = matched.get(col) if matched else None

    for spec in specs:
        if spec.op == "derive" and spec.column:
            result[spec.column] = evaluate_row_value(spec.args.get("expr", ""), result)

    for spec in specs:
        if spec.op == "cast" and spec.column and spec.column in result:
            type_ = spec.args.get("type", "string")
            value = result.get(spec.column)
            if value is not None and not parses_as(value, type_):
                result[spec.column] = None

    for spec in specs:
        if spec.op == "mask" and spec.column and spec.column in result:
            result[spec.column] = _mask_value(result.get(spec.column), spec.args)

    for spec in specs:
        if spec.op == "fill_default" and spec.column and result.get(spec.column) is None:
            result[spec.column] = str(spec.args.get("value", ""))

    return result


# ---- phase 10: sequence ----


def _apply_sequence(rows: list[IndexedRow], specs: list[TransformSpec]) -> list[IndexedRow]:
    sequence_specs = [s for s in specs if s.op == "sequence" and s.column]
    if not sequence_specs:
        return rows
    current = [(ordinal, dict(row)) for ordinal, row in rows]
    for spec in sequence_specs:
        start = int(spec.args.get("start", 1))
        step = int(spec.args.get("step", 1))
        for i, (_, row) in enumerate(current):
            row[spec.column] = str(start + i * step)
    return current


# ---- phase 11: project ----


def _apply_project(rows: list[IndexedRow], specs: list[TransformSpec]) -> list[IndexedRow]:
    project_specs = [s for s in specs if s.op == "project"]
    if not project_specs:
        return rows
    keep = set(project_specs[-1].args.get("keep") or [])
    if not keep:
        return rows
    return [(ordinal, {k: v for k, v in row.items() if k in keep}) for ordinal, row in rows]


# ---- output schema ----


def compute_output_schema(base_columns: list[dict], specs: list[TransformSpec]) -> list[dict]:
    columns = [dict(c) for c in base_columns]

    for spec in specs:
        if spec.op == "rename" and spec.column:
            to = spec.args.get("to")
            if to:
                for c in columns:
                    if c["name"] == spec.column:
                        c["name"] = to

    for spec in specs:
        if spec.op == "lookup":
            select = spec.args.get("select") or []
            prefix = spec.args.get("prefix", "")
            for col in select:
                name = f"{prefix}{col}"
                columns = [c for c in columns if c["name"] != name]
                columns.append({"name": name, "type": "string", "nullable": True})

    for spec in specs:
        if spec.op == "derive" and spec.column:
            columns = [c for c in columns if c["name"] != spec.column]
            columns.append({"name": spec.column, "type": spec.args.get("type", "string"), "nullable": True})

    for spec in specs:
        if spec.op == "cast" and spec.column:
            for c in columns:
                if c["name"] == spec.column:
                    c["type"] = spec.args.get("type", c["type"])

    for spec in specs:
        if spec.op == "sequence" and spec.column:
            columns = [c for c in columns if c["name"] != spec.column]
            columns.append({"name": spec.column, "type": "integer", "nullable": False})

    for spec in specs:
        if spec.op == "project":
            keep = set(spec.args.get("keep") or [])
            if keep:
                columns = [c for c in columns if c["name"] in keep]

    return columns


# ---- orchestrator ----


def run_transforms(
    rows: list[IndexedRow],
    specs: list[TransformSpec],
    base_columns: list[dict],
    lookup_indexes: dict[str, dict[str, Row]] | None = None,
) -> TransformResult:
    survivors, dropped_filter = _apply_filter(rows, specs)
    survivors, dropped_dedupe = _apply_dedupe(survivors, specs)
    survivors = _apply_sort(survivors, specs)

    column_specs = [
        s for s in specs if s.op in ("rename", "lookup", "derive", "cast", "mask", "fill_default")
    ]
    if column_specs:
        survivors = [
            (ordinal, _apply_column_ops(row, column_specs, lookup_indexes or {}))
            for ordinal, row in survivors
        ]

    survivors = _apply_sequence(survivors, specs)
    survivors = _apply_project(survivors, specs)

    columns = compute_output_schema(base_columns, specs)
    return TransformResult(rows=survivors, dropped=dropped_filter + dropped_dedupe, columns=columns)
