"""The Transform stage (ARCHITECTURE.md §7.1): runs on staged rows after
the gate opens, before load. Validation sees the original values -- a
not_null rule on a column still reports what was actually missing, even if
a transform later fills it in for the loaded copy.

One op for now: fill_default. More (trim, uppercase, replace...) fit the
same (column, op, args) shape without a schema change when they're needed.
"""

from dataclasses import dataclass


@dataclass
class TransformSpec:
    id: str
    column: str
    op: str
    args: dict


def apply_transforms(
    row: dict[str, str | None], specs: list[TransformSpec]
) -> dict[str, str | None]:
    result = dict(row)
    for spec in specs:
        if spec.op == "fill_default" and result.get(spec.column) is None:
            result[spec.column] = str(spec.args.get("value", ""))
    return result
