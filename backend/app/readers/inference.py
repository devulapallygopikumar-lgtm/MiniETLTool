"""Column type inference over a sample of values (ARCHITECTURE.md §4.4).

Every value in a row, from every reader, is kept as `str | None` — the raw
text as read from the source. Inference proposes a logical type from a
sample; `type_parse` (the validation rule) later checks the full column
against that pinned type. Nothing here ever mutates a value.
"""

import re
from datetime import datetime

_INT_RE = re.compile(r"^[+-]?\d+$")
_FLOAT_RE = re.compile(r"^[+-]?\d*\.\d+$|^[+-]?\d+\.\d*$")
_DATE_FORMATS = ("%Y-%m-%d", "%Y%m%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y")


def parses_as(value: str, type_: str) -> bool:
    if type_ == "integer":
        return bool(_INT_RE.match(value))
    if type_ == "number":
        return bool(_INT_RE.match(value) or _FLOAT_RE.match(value))
    if type_ == "date":
        for fmt in _DATE_FORMATS:
            try:
                datetime.strptime(value, fmt)
                return True
            except ValueError:
                continue
        return False
    return True  # "string" always parses


def infer_column_type(values: list[str | None]) -> tuple[str, bool]:
    """Returns (type, nullable) for one column from a sample of raw values."""
    nullable = False
    non_null: list[str] = []
    for v in values:
        if v is None or v == "":
            nullable = True
        else:
            non_null.append(v)

    if not non_null:
        return "string", True

    for candidate in ("integer", "number", "date"):
        if all(parses_as(v, candidate) for v in non_null):
            return candidate, nullable

    return "string", nullable


def infer_schema(sample_rows: list[dict[str, str | None]], columns: list[str]) -> list[dict]:
    result = []
    for col in columns:
        values = [row.get(col) for row in sample_rows]
        type_, nullable = infer_column_type(values)
        result.append({"name": col, "type": type_, "nullable": nullable})
    return result
