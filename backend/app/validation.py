"""The validation engine (ARCHITECTURE.md §7): the four rule types from the
two-day slice (§20.2), evaluated over the full staged row set, producing a
gate decision plus a capped issue sample per rule (§7.7).

The slice always stages (§20.3 hour 7), so every rule — including
dataset-scope ones that need the full pass — is evaluated here against the
complete in-memory row set rather than a streaming chain.
"""

from collections import defaultdict
from dataclasses import dataclass, field

from .expressions import ExpressionError, compile_expression, evaluate_control_total, is_control_total
from .readers.inference import parses_as


@dataclass
class RuleSpec:
    id: str
    scope: str
    column: str | None
    rule: str
    args: dict
    enforcement: str
    on_violation: str


@dataclass
class IssueSample:
    row_ordinal: int
    column_name: str | None
    offending_value: str | None
    message: str


@dataclass
class RuleOutcome:
    rule_id: str
    scope: str
    column: str | None
    rule: str
    enforcement: str
    violations: int
    rows_checked: int
    pass_rate: float
    issues: list[IssueSample] = field(default_factory=list)
    violating_ordinals: set[int] = field(default_factory=set)


@dataclass
class ValidationOutcome:
    gate_state: str  # "open" | "closed"
    rule_outcomes: list[RuleOutcome]
    rejected_ordinals: set[int]


def _evaluate_rule(
    spec: RuleSpec, rows: list[dict[str, str | None]], column_types: dict[str, str]
) -> dict[int, IssueSample]:
    violating: dict[int, IssueSample] = {}

    if spec.rule == "not_null":
        col = spec.column
        for i, row in enumerate(rows, start=1):
            if row.get(col) is None:
                violating[i] = IssueSample(i, col, None, f"{col} is null")

    elif spec.rule == "type_parse":
        col = spec.column
        type_ = column_types.get(col or "", "string")
        for i, row in enumerate(rows, start=1):
            v = row.get(col)
            if v is not None and not parses_as(v, type_):
                violating[i] = IssueSample(i, col, v, f"cannot parse '{v}' as {type_}")

    elif spec.rule == "unique":
        cols = spec.args.get("columns") or ([spec.column] if spec.column else [])
        groups: defaultdict[tuple, list[int]] = defaultdict(list)
        for i, row in enumerate(rows, start=1):
            groups[tuple(row.get(c) for c in cols)].append(i)
        for key, ordinals in groups.items():
            if len(ordinals) <= 1:
                continue
            label = ", ".join(f"{c}={v}" for c, v in zip(cols, key))
            for i in ordinals:
                violating[i] = IssueSample(i, ", ".join(cols), label, f"duplicate: {label}")

    elif spec.rule == "expression":
        expr = spec.args.get("expr", "")
        control = is_control_total(expr) if spec.scope == "dataset" else None
        if control:
            column, op, expected = control
            values = [row.get(column) for row in rows]
            ok, total_value = evaluate_control_total(column, op, expected, values)
            if not ok:
                violating[0] = IssueSample(
                    0,
                    column,
                    f"{total_value:g}",
                    f"sum({column}) = {total_value:g}, expected {op} {expected:g}",
                )
        else:
            try:
                compiled = compile_expression(expr)
            except ExpressionError as exc:
                for i in range(1, len(rows) + 1):
                    violating[i] = IssueSample(i, None, None, f"invalid expression: {exc}")
            else:
                for i, row in enumerate(rows, start=1):
                    if not compiled.eval_bool(row):
                        violating[i] = IssueSample(i, None, None, f"failed expression: {expr}")

    return violating


def run_validation(
    rules: list[RuleSpec],
    rows: list[dict[str, str | None]],
    column_types: dict[str, str],
    issue_cap: int,
) -> ValidationOutcome:
    total = len(rows)
    outcomes: list[RuleOutcome] = []

    for spec in rules:
        violating = _evaluate_rule(spec, rows, column_types)
        violations = len(violating)
        pass_rate = (total - violations) / total if total else 1.0
        issues = list(violating.values())[:issue_cap]
        outcomes.append(
            RuleOutcome(
                rule_id=spec.id,
                scope=spec.scope,
                column=spec.column,
                rule=spec.rule,
                enforcement=spec.enforcement,
                violations=violations,
                rows_checked=total,
                pass_rate=pass_rate,
                issues=issues,
                violating_ordinals=set(violating.keys()),
            )
        )

    gate_open = all(o.violations == 0 for o in outcomes if o.enforcement == "mandatory")

    rejected: set[int] = set()
    if gate_open:
        by_id = {s.id: s for s in rules}
        for o in outcomes:
            if o.enforcement == "move_on" and by_id[o.rule_id].on_violation == "reject_row":
                rejected |= o.violating_ordinals

    return ValidationOutcome(
        gate_state="open" if gate_open else "closed",
        rule_outcomes=outcomes,
        rejected_ordinals=rejected,
    )
