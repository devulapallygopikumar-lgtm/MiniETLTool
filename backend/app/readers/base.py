from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class DiscoveredEntity:
    entity_name: str
    format: str
    spec: dict[str, Any]
    columns: list[dict]
    sample_row_count: int


_EXT_FORMATS = {
    "csv": "csv",
    "tsv": "csv",
    "xlsx": "excel",
    "xlsm": "excel",
    "xls": "excel",
    "xml": "xml",
}


def detect_format(filename: str) -> str | None:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return _EXT_FORMATS.get(ext)


def discover_entities(path: Path, format: str) -> list[DiscoveredEntity]:
    from . import csv_reader, excel_reader, xml_reader, xml_tally_masters_reader, xml_tally_reader

    if format == "csv":
        return csv_reader.discover(path)
    if format == "excel":
        return excel_reader.discover(path)
    if format == "xml":
        return xml_reader.discover(path)
    if format == "xml-tally":
        return xml_tally_reader.discover(path)
    if format == "xml-tally-masters":
        return xml_tally_masters_reader.discover(path)
    raise ValueError(f"Unsupported format: {format}")


def read_rows(path: Path, format: str, spec: dict[str, Any]) -> Iterator[dict[str, str | None]]:
    from . import csv_reader, excel_reader, xml_reader, xml_tally_masters_reader, xml_tally_reader

    if format == "csv":
        yield from csv_reader.read_rows(path, spec)
    elif format == "excel":
        yield from excel_reader.read_rows(path, spec)
    elif format == "xml":
        yield from xml_reader.read_rows(path, spec)
    elif format == "xml-tally":
        yield from xml_tally_reader.read_rows(path, spec)
    elif format == "xml-tally-masters":
        yield from xml_tally_masters_reader.read_rows(path, spec)
    else:
        raise ValueError(f"Unsupported format: {format}")
