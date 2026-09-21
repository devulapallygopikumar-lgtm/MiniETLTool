"""CSV/TSV reader (ARCHITECTURE.md §4.3): encoding sniffing incl. UTF-16 + BOM,
delimiter sniffed from the header line, header row required."""

import csv
from pathlib import Path
from typing import Any

from ..config import settings
from .base import DiscoveredEntity
from .inference import infer_schema

_DELIMITERS = [",", ";", "\t", "|"]


def _detect_encoding(path: Path) -> str:
    with open(path, "rb") as f:
        head = f.read(4)
    if head.startswith(b"\xff\xfe"):
        return "utf-16"
    if head.startswith(b"\xfe\xff"):
        return "utf-16"
    if head.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    return "utf-8"


def _detect_delimiter(path: Path, encoding: str) -> str:
    with open(path, "r", encoding=encoding, errors="replace", newline="") as f:
        first_line = f.readline()
    counts = {d: first_line.count(d) for d in _DELIMITERS}
    best = max(counts, key=lambda d: counts[d])
    return best if counts[best] > 0 else ","


def discover(path: Path) -> list[DiscoveredEntity]:
    encoding = _detect_encoding(path)
    delimiter = _detect_delimiter(path, encoding)
    sample_rows: list[dict[str, str | None]] = []
    with open(path, "r", encoding=encoding, errors="replace", newline="") as f:
        reader = csv.DictReader(f, delimiter=delimiter)
        columns = list(reader.fieldnames or [])
        for i, row in enumerate(reader):
            if i >= settings.schema_sample_rows:
                break
            sample_rows.append({k: (v if v not in (None, "") else None) for k, v in row.items()})

    schema = infer_schema(sample_rows, columns)
    entity_name = path.stem
    return [
        DiscoveredEntity(
            entity_name=entity_name,
            format="csv",
            spec={"encoding": encoding, "delimiter": delimiter, "columns": columns},
            columns=schema,
            sample_row_count=len(sample_rows),
        )
    ]


def read_rows(path: Path, spec: dict[str, Any]):
    encoding = spec["encoding"]
    delimiter = spec["delimiter"]
    with open(path, "r", encoding=encoding, errors="replace", newline="") as f:
        reader = csv.DictReader(f, delimiter=delimiter)
        for row in reader:
            yield {k: (v if v not in (None, "") else None) for k, v in row.items()}
