"""Excel reader (ARCHITECTURE.md §4.3/§4.5): one dataset per sheet.

Two backends: `openpyxl` for the modern `.xlsx`/`.xlsm` format, and `xlrd`
for the legacy binary `.xls` format (OLE2/BIFF) that openpyxl can't read at
all. Which one to use is decided from the file's actual signature, not its
extension — real exports have shown up as a genuine OLE2 `.xls` and also,
separately, as a `.xlsx` (ZIP) file mislabeled with a `.xls` extension.
"""

from datetime import date, datetime
from itertools import chain, islice
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


def _cell_str(value: Any, trim: bool = False) -> str | None:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    text = str(value)
    if trim:
        text = text.strip()
        return text or None
    return text


# ---- Excel upload options ----
#
# These apply to Excel uploads only; the CSV/XML readers are untouched. They
# are stored in the entity spec, so re-reading a dataset later behaves exactly
# as its discovery did. A spec saved before they existed has none of the keys
# and falls back to the old behaviour (header in row 1, no trimming).
#
#   has_header  first row (at start_row) holds the column names; otherwise
#               columns are col_1..col_N and that row is data
#   start_row   1-based row where the header/data begins; rows above (titles,
#               report banners) are skipped. None = auto-detect per sheet; the
#               detected row is what gets stored in the spec.
#   trim        strip leading/trailing whitespace from cells; blank -> NULL

_AUTO_SCAN_ROWS = 20


def _opts(raw: dict[str, Any] | None) -> dict[str, Any]:
    raw = raw or {}
    start = raw.get("start_row", 1)
    return {
        "has_header": bool(raw.get("has_header", True)),
        "start_row": None if start is None else max(1, int(start)),
        "trim": bool(raw.get("trim", False)),
    }


def _filled(row) -> int:
    return sum(1 for v in row if v is not None and str(v).strip() != "")


def _detect_start(rows: list) -> int:
    """0-based index of the first row that looks like a header/data row: a
    title or banner line has only a cell or two filled, the real header spans
    (nearly) the full width of the sheet."""
    counts = [_filled(r) for r in rows]
    widest = max(counts, default=0)
    if widest < 2:
        return 0
    need = max(2, -(-widest * 6 // 10))  # ceil(60% of the widest row)
    return next(i for i, c in enumerate(counts) if c >= need)


def _unique_names(header: list[Any]) -> list[str]:
    """Header cells -> column names: blanks become col_N, repeats get _2, _3..."""
    names: list[str] = []
    seen: set[str] = set()
    for i, c in enumerate(header):
        # Collapse runs of whitespace/newlines: Excel headers are often wrapped
        # onto two lines ("S.\nNO"), which makes an unusable column name.
        name = " ".join(str(c).split()) if c is not None else ""
        name = name or f"col_{i + 1}"
        base, n = name, 2
        while name in seen:
            name = f"{base}_{n}"
            n += 1
        seen.add(name)
        names.append(name)
    return names


def _split_header(rows_iter, opts: dict[str, Any]):
    """Skip rows above the start row, then return (columns, remaining data rows,
    start_row actually used), or (None, empty, 1) for a sheet with nothing there."""
    start = opts["start_row"]
    if start is None:
        head = list(islice(rows_iter, _AUTO_SCAN_ROWS))
        skip = _detect_start(head)
        start = skip + 1
        rows_iter = chain(head[skip:], rows_iter)
    else:
        for _ in range(start - 1):
            if next(rows_iter, None) is None:
                return None, iter(()), start
    first = next(rows_iter, None)
    if first is None:
        return None, iter(()), start
    if opts["has_header"]:
        return _unique_names(list(first)), rows_iter, start
    columns = [f"col_{i + 1}" for i in range(len(first))]
    return columns, chain([first], rows_iter), start


def _skip_to_data(rows_iter, opts: dict[str, Any]) -> None:
    for _ in range(opts["start_row"] - 1 + (1 if opts["has_header"] else 0)):
        next(rows_iter, None)


def _entity(sheet_name: str, columns: list[str], sample_rows: list[dict], opts: dict[str, Any]) -> DiscoveredEntity:
    return DiscoveredEntity(
        entity_name=sheet_name,
        format="excel",
        spec={"sheet": sheet_name, "columns": columns, **opts},
        columns=infer_schema(sample_rows, columns),
        sample_row_count=len(sample_rows),
    )


def discover(path: Path, options: dict[str, Any] | None = None) -> list[DiscoveredEntity]:
    opts = _opts(options)
    if _is_legacy_xls(path):
        return _discover_xls(path, opts)
    return _discover_xlsx(path, opts)


def read_rows(path: Path, spec: dict[str, Any]):
    opts = _opts(spec)
    if _is_legacy_xls(path):
        yield from _read_rows_xls(path, spec, opts)
    else:
        yield from _read_rows_xlsx(path, spec, opts)


# ---- .xlsx / .xlsm (openpyxl) ----


def _discover_xlsx(path: Path, opts: dict[str, Any]) -> list[DiscoveredEntity]:
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
            columns, rows_iter, start = _split_header(ws.iter_rows(values_only=True), opts)
            if columns is None:
                continue
            sheet_opts = {**opts, "start_row": start}
            sample_rows: list[dict[str, str | None]] = []
            for row in rows_iter:
                if len(sample_rows) >= settings.schema_sample_rows:
                    break
                values = [_cell_str(v, opts["trim"]) for v in row]
                if all(v is None for v in values):
                    continue
                sample_rows.append({columns[j]: values[j] for j in range(len(columns)) if j < len(values)})
            entities.append(_entity(sheet_name, columns, sample_rows, sheet_opts))
    finally:
        wb.close()
        f.close()
    return entities


def _read_rows_xlsx(path: Path, spec: dict[str, Any], opts: dict[str, Any]):
    f = open(path, "rb")
    wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
    try:
        ws = wb[spec["sheet"]]
        columns: list[str] = spec["columns"]
        rows_iter = ws.iter_rows(values_only=True)
        _skip_to_data(rows_iter, opts)
        for row in rows_iter:
            values = [_cell_str(v, opts["trim"]) for v in row]
            if all(v is None for v in values):
                continue
            yield {columns[j]: values[j] for j in range(len(columns)) if j < len(values)}
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


def _xls_rows(sheet, datemode: int):
    for r in range(sheet.nrows):
        yield [_xls_cell_str(c, datemode) for c in sheet.row(r)]


def _discover_xls(path: Path, opts: dict[str, Any]) -> list[DiscoveredEntity]:
    import xlrd

    wb = xlrd.open_workbook(path)
    entities: list[DiscoveredEntity] = []
    for sheet in wb.sheets():
        if sheet.nrows == 0:
            continue
        columns, rows_iter, start = _split_header(_xls_rows(sheet, wb.datemode), opts)
        if columns is None:
            continue
        sheet_opts = {**opts, "start_row": start}
        sample_rows: list[dict[str, str | None]] = []
        for values in rows_iter:
            if len(sample_rows) >= settings.schema_sample_rows:
                break
            if all(v is None for v in values):
                continue
            sample_rows.append({columns[j]: values[j] for j in range(len(columns)) if j < len(values)})
        entities.append(_entity(sheet.name, columns, sample_rows, sheet_opts))
    return entities


def _read_rows_xls(path: Path, spec: dict[str, Any], opts: dict[str, Any]):
    import xlrd

    wb = xlrd.open_workbook(path)
    sheet = wb.sheet_by_name(spec["sheet"])
    columns: list[str] = spec["columns"]
    rows_iter = _xls_rows(sheet, wb.datemode)
    _skip_to_data(rows_iter, opts)
    for values in rows_iter:
        if all(v is None for v in values):
            continue
        yield {columns[j]: values[j] for j in range(len(columns)) if j < len(values)}
