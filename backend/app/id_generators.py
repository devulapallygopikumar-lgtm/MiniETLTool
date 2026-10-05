"""ID generators for target columns that have no source field.

A mapping field can carry a `generate` spec instead of a `source`
(see schemas.GenerateSpec). The loader builds one generator per column with
`make_id_generator` and calls it once per row:

    next_id = make_id_generator({"kind": "sequence", "prefix": "INV-", "start": 1, "pad": 5})
    next_id()  # 'INV-00001'
    next_id()  # 'INV-00002'

    make_id_generator({"kind": "uuid"})()  # '3f2b8c1e-...' (random UUID v4)

A sequence starts at `start` for every run. When loading into a table that
already holds generated IDs, the loader passes the next free number as
`start` so runs don't collide.
"""

import uuid
from collections.abc import Callable
from itertools import count
from typing import Any


def format_sequence_id(n: int, prefix: str = "", pad: int = 0) -> str:
    return f"{prefix}{n:0{pad}d}"


def make_id_generator(spec: dict[str, Any]) -> Callable[[], str]:
    kind = spec.get("kind")
    if kind == "uuid":
        return lambda: str(uuid.uuid4())
    if kind == "sequence":
        prefix = spec.get("prefix", "")
        pad = int(spec.get("pad", 0))
        numbers = count(int(spec.get("start", 1)), int(spec.get("step", 1)))
        return lambda: format_sequence_id(next(numbers), prefix, pad)
    raise ValueError(f"Unknown ID generator kind: {kind!r}")
