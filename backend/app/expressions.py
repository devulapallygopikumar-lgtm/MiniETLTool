"""The expression rule evaluator (ARCHITECTURE.md §20.2): one small DSL that
covers range checks, regex, enum/domain lists, cross-column comparisons and
control totals as configuration rather than more rule types.

    amount between -1e9 and 1e9
    gstin ~ '^[0-9]{2}[A-Z]{5}'
    status in ('Y','N')
    effective_date >= voucher_date
    sum(amount) = 0                    (dataset-scope control total)

A row-scope expression is translated to a Python-looking boolean
expression and evaluated per row with column values in scope. A
dataset-scope `sum(col) op value` control total is recognised separately
and evaluated once over the full column.

This is *not* backed by eval(): a rule/transform's `expr` is user text
(from the Validation rules and Transforms editors), and `eval(code,
{"__builtins__": {}}, namespace)` -- what this module used to do -- is a
well-known-broken sandbox. Stripping __builtins__ from globals doesn't
stop an expression reaching arbitrary classes; every object still
exposes its own type, so `().__class__.__bases__[0].__subclasses__()`
walks straight past it to anything importable, including things that
run shell commands. compile_expression() instead parses the expression
to an AST and only ever executes it through _Evaluator, which has a
visit_ method for each of a small, fixed set of node shapes and raises
on anything else -- there is no eval()/exec()/compile()-of-code-that-
runs anywhere below this point, so there is nothing to escape *to*.
"""

import ast
import operator
import re
from typing import Callable

_BETWEEN_RE = re.compile(r"^(.+?)\s+between\s+(.+?)\s+and\s+(.+)$", re.IGNORECASE)
_MATCH_RE = re.compile(r"^(.+?)\s*~\s*(.+)$")
_BARE_EQ_RE = re.compile(r"(?<![=!<>])=(?!=)")
_CONTROL_TOTAL_RE = re.compile(
    r"^\s*sum\(\s*([A-Za-z_][\w]*)\s*\)\s*(=|==|!=|<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)\s*$"
)


class ExpressionError(ValueError):
    """expr isn't valid, or uses something outside the DSL's allowed
    shapes -- raised once, at compile_expression() time, not per row."""


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


# ---- the safe subset ---------------------------------------------------
#
# Only what the DSL above actually needs: boolean combination, the
# handful of arithmetic operators `derive` uses, comparisons (including
# `in`/`not in` for enum lists), literals, tuples/lists, and calls -- but
# only to regex_match, checked by name, never by attribute. No Attribute,
# Subscript, Lambda, comprehension, Import or Starred node is handled
# anywhere below, which is what keeps this from being eval() with extra
# steps: there is no path from "parses" to "runs" for anything not on
# this list.

_COMPARE_OPS: dict[type, Callable[[object, object], bool]] = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
    ast.In: lambda a, b: a in b,
    ast.NotIn: lambda a, b: a not in b,
}

_BIN_OPS: dict[type, Callable[[object, object], object]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
}

_FUNCS: dict[str, Callable] = {"regex_match": _regex_match}

# Every node type that can appear in a validated expression, including
# operator nodes (ast.And, ast.Eq, ...) and the Load context every Name/
# Tuple/List carries -- ast.iter_child_nodes walks into those too, so
# they need to be on this list or a plain `x == y` would already fail.
_ALLOWED_NODE_TYPES = (
    ast.Expression,
    ast.BoolOp, ast.And, ast.Or,
    ast.UnaryOp, ast.Not, ast.USub, ast.UAdd,
    ast.BinOp, ast.Add, ast.Sub, ast.Mult, ast.Div,
    ast.Compare, ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.In, ast.NotIn,
    ast.Name, ast.Load, ast.Constant, ast.Tuple, ast.List, ast.Call,
)


def _check_shape(node: ast.AST) -> None:
    """Structural whitelist pass, with no row data involved -- run once,
    at compile time. Raises on the first node that isn't one of the
    shapes above, or a Call to anything but a whitelisted function name
    (checked by identifier, never by attribute)."""
    if not isinstance(node, _ALLOWED_NODE_TYPES):
        raise ExpressionError(f"'{type(node).__name__}' isn't allowed in an expression")
    if isinstance(node, ast.Call):
        if node.keywords:
            raise ExpressionError("keyword arguments aren't supported")
        if not isinstance(node.func, ast.Name) or node.func.id not in _FUNCS:
            allowed = ", ".join(sorted(_FUNCS))
            raise ExpressionError(f"calls are only allowed to: {allowed}")
    for child in ast.iter_child_nodes(node):
        _check_shape(child)


class _Evaluator:
    """Computes a pre-validated node's value against one row's columns.
    Defense in depth alongside _check_shape: even if that whitelist had
    a bug, this only knows how to compute the same fixed set of shapes
    -- there's a visit_ method per allowed node type and nothing else,
    so an unhandled node still raises here rather than silently running."""

    __slots__ = ("namespace",)

    def __init__(self, namespace: dict[str, object]):
        self.namespace = namespace

    def visit(self, node: ast.AST) -> object:
        method = getattr(self, f"_visit_{type(node).__name__}", None)
        if method is None:
            raise ExpressionError(f"unsupported expression: {type(node).__name__}")
        return method(node)

    def _visit_Expression(self, node: ast.Expression) -> object:
        return self.visit(node.body)

    def _visit_BoolOp(self, node: ast.BoolOp) -> object:
        values = (self.visit(v) for v in node.values)
        return all(values) if isinstance(node.op, ast.And) else any(values)

    def _visit_UnaryOp(self, node: ast.UnaryOp) -> object:
        operand = self.visit(node.operand)
        if isinstance(node.op, ast.Not):
            return not operand
        if isinstance(node.op, ast.USub):
            return -operand
        return operand  # ast.UAdd

    def _visit_BinOp(self, node: ast.BinOp) -> object:
        op = _BIN_OPS.get(type(node.op))
        if op is None:
            raise ExpressionError("unsupported arithmetic operator")
        return op(self.visit(node.left), self.visit(node.right))

    def _visit_Compare(self, node: ast.Compare) -> bool:
        left = self.visit(node.left)
        for op_node, comparator in zip(node.ops, node.comparators):
            op = _COMPARE_OPS.get(type(op_node))
            if op is None:
                raise ExpressionError("unsupported comparison")
            right = self.visit(comparator)
            if not op(left, right):
                return False
            left = right
        return True

    def _visit_Name(self, node: ast.Name) -> object:
        if node.id in self.namespace:
            return self.namespace[node.id]
        raise ExpressionError(f"unknown column: {node.id}")

    def _visit_Constant(self, node: ast.Constant) -> object:
        if node.value is None or isinstance(node.value, (bool, int, float, str)):
            return node.value
        raise ExpressionError("unsupported literal")

    def _visit_Tuple(self, node: ast.Tuple) -> tuple:
        return tuple(self.visit(elt) for elt in node.elts)

    def _visit_List(self, node: ast.List) -> list:
        return [self.visit(elt) for elt in node.elts]

    def _visit_Call(self, node: ast.Call) -> object:
        # node.func was already checked by _check_shape; recovered by
        # name, never resolved as a Name lookup, so a row column literally
        # called "regex_match" can't shadow it.
        func = _FUNCS[node.func.id]  # type: ignore[union-attr]
        return func(*(self.visit(a) for a in node.args))


class CompiledExpression:
    """A validated expression, ready to run against many rows without
    re-parsing or re-checking its shape each time."""

    __slots__ = ("_tree", "source")

    def __init__(self, tree: ast.Expression, source: str):
        self._tree = tree
        self.source = source

    def eval_bool(self, row: dict[str, str | None]) -> bool:
        """Returns True if the row satisfies the expression (i.e. no
        violation). Any runtime error (missing column, a comparison
        between incompatible types) is treated conservatively as a
        violation -- the same policy the old eval()-based version used."""
        try:
            return bool(_Evaluator(_row_namespace(row)).visit(self._tree))
        except Exception:
            return False

    def eval_value(self, row: dict[str, str | None]) -> str | None:
        """Evaluates the expression as a *value* (for the `derive`
        transform) rather than a pass/fail. Any runtime error yields
        None, the same conservative default used everywhere else in the
        pipeline for "this row didn't have what was needed"."""
        try:
            result = _Evaluator(_row_namespace(row)).visit(self._tree)
        except Exception:
            return None
        if result is None:
            return None
        if isinstance(result, float) and result.is_integer():
            return str(int(result))
        return str(result)


def _row_namespace(row: dict[str, str | None]) -> dict[str, object]:
    return {k: _coerce(v) for k, v in row.items()}


def compile_expression(expr: str) -> CompiledExpression:
    """Translates and validates expr once; call .eval_bool()/.eval_value()
    on the result for every row instead of re-parsing per row. Raises
    ExpressionError -- with a message safe to show the person who wrote
    the rule -- for bad syntax or anything outside the allowed shapes."""
    code = _translate(expr)
    try:
        tree = ast.parse(code, mode="eval")
    except SyntaxError as exc:
        raise ExpressionError(f"invalid syntax: {exc.msg}") from exc
    _check_shape(tree)
    return CompiledExpression(tree, expr)
