"""The expression rule evaluator (ARCHITECTURE.md §20.2): one small DSL that
covers range checks, regex, enum/domain lists, cross-column comparisons and
control totals as configuration rather than more rule types.

    amount between -1e9 and 1e9
    gstin ~ '^[0-9]{2}[A-Z]{5}'
    status in ('Y','N')
    effective_date >= voucher_date
    sum(amount) = 0                    (dataset-scope control total)

A row-scope expression is translated to a Python boolean expression and
evaluated per row with column values in scope. A dataset-scope `sum(col) op
value` control total is recognised separately and evaluated once over the
full column.
"""

import re

_BETWEEN_RE = re.compile(r"^(.+?)\s+between\s+(.+?)\s+and\s+(.+)$", re.IGNORECASE)
_MATCH_RE = re.compile(r"^(.+?)\s*~\s*(.+)$")
_BARE_EQ_RE = re.compile(r"(?<![=!<>])=(?!=)")
_CONTROL_TOTAL_RE = re.compile(
    r"^\s*sum\(\s*([A-Za-z_][\w]*)\s*\)\s*(=|==|!=|<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)\s*$"
)

_ALLOWED_NAMES = {"None": None, "True": True, "False": False}


def _translate(expr: str) -> str:
    m = _BETWEEN_RE.match(expr)
    if m:
        col, lo, hi = m.groups()
        expr = f"({col} >= {lo}) and ({col} <= {hi})"

    m = _MATCH_RE.match(expr)
    if m:
        left, pattern = m.groups()
        expr = f"regex_match({left}, {pattern})"

    return _BARE_EQ_RE.sub("==", expr)


def is_control_total(expr: str) -> tuple[str, str, float] | None:
    m = _CONTROL_TOTAL_RE.match(expr)
    if not m:
        return None
    column, op, value = m.groups()
    return column, op, float(value)


def _coerce(value: str | None) -> str | float | None:
    if value is None:
        return None
    try:
        return float(value) if ("." in value or "e" in value.lower()) else int(value)
    except ValueError:
        return value


def _regex_match(value: str | float | None, pattern: str) -> bool:
    if value is None:
        return False
    return re.match(pattern, str(value)) is not None


def evaluate_row_expression(expr: str, row: dict[str, str | None]) -> bool:
    """Returns True if the row satisfies the expression (i.e. no violation).
    Any evaluation error (missing column, type mismatch, bad expression) is
    treated conservatively as a violation."""
    code = _translate(expr)
    namespace: dict[str, object] = {k: _coerce(v) for k, v in row.items()}
    namespace["regex_match"] = _regex_match
    namespace.update(_ALLOWED_NAMES)
    try:
        return bool(eval(code, {"__builtins__": {}}, namespace))  # noqa: S307
    except Exception:
        return False


def evaluate_control_total(column: str, op: str, expected: float, values: list[str | None]) -> tuple[bool, float]:
    total = 0.0
    for v in values:
        coerced = _coerce(v)
        if isinstance(coerced, (int, float)):
            total += coerced
    ops = {
        "=": lambda a, b: a == b,
        "==": lambda a, b: a == b,
        "!=": lambda a, b: a != b,
        "<=": lambda a, b: a <= b,
        ">=": lambda a, b: a >= b,
        "<": lambda a, b: a < b,
        ">": lambda a, b: a > b,
    }
    return ops[op](round(total, 6), expected), total
