"""Excel reader (ARCHITECTURE.md §4.3/§4.5): one dataset per sheet.

Two backends: `openpyxl` for the modern `.xlsx`/`.xlsm` format, and `xlrd`
for the legacy binary `.xls` format (OLE2/BIFF) that openpyxl can't read at
all. Which one to use is decided from the file's actual signature, not its
extension — real exports have shown up as a genuine OLE2 `.xls` and also,
separately, as a `.xlsx` (ZIP) file mislabeled with a `.xls` extension.
"""

from datetime import date, datetime
from pathlib import Path
from typing import Any

import openpyxl

from ..config import settings
from .base import DiscoveredEntity
from .inference import infer_schema


_OLE2_SIGNATURE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_ZIP_SIGNATURE = b"PK\x03\x04"


def _is_legacy_xls(path: Path) -> bool:
    # Extension isn't trustworthy on its own -- real exports have shown up
    # with a `.xls` extension on what's actually a `.xlsx` (ZIP) file.
    # Sniff the real format from its signature instead.
    with open(path, "rb") as f:
        head = f.read(8)
    if head.startswith(_ZIP_SIGNATURE):
        return False
    if head.startswith(_OLE2_SIGNATURE):
        return True
    return path.suffix.lower() == ".xls"


def _cell_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def discover(path: Path) -> list[DiscoveredEntity]:
    if _is_legacy_xls(path):
        return _discover_xls(path)
    return _discover_xlsx(path)


def read_rows(path: Path, spec: dict[str, Any]):
    if _is_legacy_xls(path):
        yield from _read_rows_xls(path, spec)
    else:
        yield from _read_rows_xlsx(path, spec)


# ---- .xlsx / .xlsm (openpyxl) ----


def _discover_xlsx(path: Path) -> list[DiscoveredEntity]:
    # A file handle, not the path string: openpyxl's own loader re-checks
    # the *extension* internally and rejects anything not ending in
    # .xlsx/.xlsm regardless of actual content -- exactly the mismatch this
    # reader exists to route around (a real .xlsx mislabeled as .xls). That
    # check only runs for a path string, never for a file-like object.
    f = open(path, "rb")
    wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
    entities: list[DiscoveredEntity] = []
    try:
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            rows_iter = ws.iter_rows(values_only=True)
            try:
                header = next(rows_iter)
            except StopIteration:
                continue
            columns = [
                (str(c).strip() if c is not None else f"col_{i + 1}")
                for i, c in enumerate(header)
            ]
            sample_rows: list[dict[str, str | None]] = []
            for i, row in enumerate(rows_iter):
                if i >= settings.schema_sample_rows:
                    break
                if all(v is None for v in row):
                    continue
                sample_rows.append(
                    {columns[j]: _cell_str(row[j]) for j in range(len(columns)) if j < len(row)}
                )
            schema = infer_schema(sample_rows, columns)
            entities.append(
                DiscoveredEntity(
                    entity_name=sheet_name,
                    format="excel",
                    spec={"sheet": sheet_name, "columns": columns},
                    columns=schema,
                    sample_row_count=len(sample_rows),
                )
            )
    finally:
        wb.close()
        f.close()
    return entities


def _read_rows_xlsx(path: Path, spec: dict[str, Any]):
    f = open(path, "rb")
    wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
    try:
        ws = wb[spec["sheet"]]
        columns: list[str] = spec["columns"]
        rows_iter = ws.iter_rows(values_only=True)
        next(rows_iter, None)  # header
        for row in rows_iter:
            if all(v is None for v in row):
                continue
            yield {columns[j]: _cell_str(row[j]) for j in range(len(columns)) if j < len(row)}
    finally:
        wb.close()
        f.close()


# ---- legacy .xls (xlrd) ----


def _format_xls_number(value: float) -> str:
    if value == int(value):
        return str(int(value))
    return str(value)


def _xls_cell_str(cell: Any, datemode: int) -> str | None:
    import xlrd

    ctype = cell.ctype
    value = cell.value
    if ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
        return None
    if ctype == xlrd.XL_CELL_TEXT:
        return value.strip() if value else None
    if ctype == xlrd.XL_CELL_NUMBER:
        return _format_xls_number(value)
    if ctype == xlrd.XL_CELL_DATE:
        return xlrd.xldate_as_datetime(value, datemode).isoformat()
    if ctype == xlrd.XL_CELL_BOOLEAN:
        return "True" if value else "False"
    if ctype == xlrd.XL_CELL_ERROR:
        return None
    return str(value) if value != "" else None


def _discover_xls(path: Path) -> list[DiscoveredEntity]:
    import xlrd

    wb = xlrd.open_workbook(path)
    entities: list[DiscoveredEntity] = []
    for sheet in wb.sheets():
        if sheet.nrows == 0:
            continue
        columns = [
            (str(c.value).strip() if c.value not in (None, "") else f"col_{i + 1}")
            for i, c in enumerate(sheet.row(0))
        ]
        sample_rows: list[dict[str, str | None]] = []
        for r in range(1, sheet.nrows):
            if len(sample_rows) >= settings.schema_sample_rows:
                break
            values = [_xls_cell_str(c, wb.datemode) for c in sheet.row(r)]
            if all(v is None for v in values):
                continue
            sample_rows.append({columns[j]: values[j] for j in range(len(columns)) if j < len(values)})
        schema = infer_schema(sample_rows, columns)
        entities.append(
            DiscoveredEntity(
                entity_name=sheet.name,
                format="excel",
                spec={"sheet": sheet.name, "columns": columns},
                columns=schema,
                sample_row_count=len(sample_rows),
            )
        )
    return entities


def _read_rows_xls(path: Path, spec: dict[str, Any]):
    import xlrd

    wb = xlrd.open_workbook(path)
    sheet = wb.sheet_by_name(spec["sheet"])
    columns: list[str] = spec["columns"]
    for r in range(1, sheet.nrows):
        values = [_xls_cell_str(c, wb.datemode) for c in sheet.row(r)]
        if all(v is None for v in values):
            continue
        yield {columns[j]: values[j] for j in range(len(columns)) if j < len(values)}
