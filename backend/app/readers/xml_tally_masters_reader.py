"""Tally masters export reader (source format `xml-tally-masters`).

The masters counterpart to `xml_tally_reader.py`: that reader recognizes a
*transactions* export (`<VOUCHER>` elements) and produces vouchers /
ledger_entries / bill_allocations. A *masters* export ("All Masters" report)
carries no `<VOUCHER>` at all — instead `<GROUP>`, `<LEDGER>` and
`<CURRENCY>` elements, the chart-of-accounts tree and account masters. This
reader is auto-selected for that shape instead, reproducing
`parse_tally_masters.py`'s exact three tables and column layout, including
its guid-based de-duplication (Tally re-emits an unchanged master once per
alteration batch in some exports; counting those as distinct masters would
be wrong).

Reuses `xml_reader`'s sanitizing stream (`_open_source`) rather than
`parse_tally_masters.py`'s own per-chunk regex, for the same reason
`xml_tally_reader.py` does: that regex has no chunk-boundary handling, so
an illegal `&#4;`-style reference split across a 1MB chunk edge reaches the
parser unstripped.
"""

import xml.etree.ElementTree as ET
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from .base import DiscoveredEntity
from .xml_reader import _local, _open_source

GROUP_COLUMNS = [
    "guid", "name", "parent", "is_revenue", "affects_gross_profit",
    "is_deemed_positive", "is_bill_wise_on", "is_cost_centres_on",
    "sort_position", "alter_id", "is_deleted",
]
LEDGER_COLUMNS = [
    "guid", "name", "parent", "opening_balance", "currency",
    "mailing_name", "address", "state", "country", "pincode",
    "income_tax_number", "gst_applicable", "is_bill_wise_on",
    "is_cost_centres_on", "affects_stock", "alter_id", "is_deleted",
]
CURRENCY_COLUMNS = [
    "guid", "name", "mailing_name", "decimal_places",
    "decimal_places_for_printing", "alter_id", "is_deleted",
]

_ENTITIES = {
    "groups": GROUP_COLUMNS,
    "ledgers": LEDGER_COLUMNS,
    "currencies": CURRENCY_COLUMNS,
}
_TAG_TO_KIND = {"GROUP": "groups", "LEDGER": "ledgers", "CURRENCY": "currencies"}

_TYPE_OVERRIDES = {
    "opening_balance": "number",
    "sort_position": "integer",
    "decimal_places": "integer",
    "decimal_places_for_printing": "integer",
}
_NOT_NULL_COLUMNS = {"guid", "name"}


def looks_like_tally_masters(path: Path, sniff_bytes: int = 262_144) -> bool:
    try:
        with open(path, "rb") as f:
            head = f.read(sniff_bytes)
    except OSError:
        return False
    text = head.decode("utf-16", errors="ignore") + head.decode("utf-8", errors="ignore")
    if "TALLYMESSAGE" not in text or "<VOUCHER" in text:
        return False
    return "<GROUP" in text or "<LEDGER " in text or "<LEDGER>" in text or "<CURRENCY" in text


def _text(el: ET.Element | None, tag: str, default: str = "") -> str:
    if el is None:
        return default
    child = el.find(tag)
    if child is None or child.text is None:
        return default
    return child.text.strip()


def _addr(el: ET.Element) -> str:
    md = el.find("LEDMAILINGDETAILS.LIST")
    if md is None:
        return ""
    al = md.find("ADDRESS.LIST")
    if al is None:
        return ""
    lines = [a.text.strip() for a in al.findall("ADDRESS") if a.text]
    return ", ".join(lines)


def _mailing(el: ET.Element, tag: str) -> str:
    md = el.find("LEDMAILINGDETAILS.LIST")
    if md is None:
        return ""
    return _text(md, tag)


def _iter_entities(path: Path) -> Iterator[ET.Element]:
    source = _open_source(path)
    try:
        for _, elem in ET.iterparse(source, events=("end",)):
            if _local(elem.tag) in _TAG_TO_KIND:
                yield elem
                elem.clear()
    finally:
        source.close()


def _iter_all(path: Path) -> Iterator[tuple[str, dict[str, str]]]:
    seen_guids: dict[str, set[str]] = {kind: set() for kind in _ENTITIES}

    for el in _iter_entities(path):
        tag = _local(el.tag)
        kind = _TAG_TO_KIND[tag]
        guid = _text(el, "GUID")
        name = el.get("NAME") or _text(el, "NAME")

        # A masters export commonly repeats an unchanged master once per
        # alteration batch; de-dupe on guid so counts/rows reflect distinct
        # masters, not export repeats (matches parse_tally_masters.py).
        if guid:
            bucket = seen_guids[kind]
            if guid in bucket:
                continue
            bucket.add(guid)

        if kind == "groups":
            yield kind, {
                "guid": guid,
                "name": name,
                "parent": el.get("PARENT") or _text(el, "PARENT"),
                "is_revenue": _text(el, "ISREVENUE"),
                "affects_gross_profit": _text(el, "AFFECTSGROSSPROFIT"),
                "is_deemed_positive": _text(el, "ISDEEMEDPOSITIVE"),
                "is_bill_wise_on": _text(el, "ISBILLWISEON"),
                "is_cost_centres_on": _text(el, "ISCOSTCENTRESON"),
                "sort_position": _text(el, "SORTPOSITION"),
                "alter_id": _text(el, "ALTERID"),
                "is_deleted": _text(el, "ISDELETED"),
            }
        elif kind == "ledgers":
            yield kind, {
                "guid": guid,
                "name": name,
                "parent": el.get("PARENT") or _text(el, "PARENT"),
                "opening_balance": _text(el, "OPENINGBALANCE"),
                "currency": _text(el, "CURRENCYNAME"),
                "mailing_name": _mailing(el, "MAILINGNAME") or name,
                "address": _addr(el),
                "state": _mailing(el, "STATE"),
                "country": _mailing(el, "COUNTRY"),
                "pincode": _mailing(el, "PINCODE"),
                "income_tax_number": _text(el, "INCOMETAXNUMBER"),
                "gst_applicable": _text(el, "GSTAPPLICABLE"),
                "is_bill_wise_on": _text(el, "ISBILLWISEON"),
                "is_cost_centres_on": _text(el, "ISCOSTCENTRESON"),
                "affects_stock": _text(el, "AFFECTSSTOCK"),
                "alter_id": _text(el, "ALTERID"),
                "is_deleted": _text(el, "ISDELETED"),
            }
        else:
            yield kind, {
                "guid": guid,
                "name": name,
                "mailing_name": _text(el, "MAILINGNAME"),
                "decimal_places": _text(el, "DECIMALPLACES"),
                "decimal_places_for_printing": _text(el, "DECIMALPLACESFORPRINTING"),
                "alter_id": _text(el, "ALTERID"),
                "is_deleted": _text(el, "ISDELETED"),
            }


def _schema_for(columns: list[str]) -> list[dict]:
    return [
        {"name": c, "type": _TYPE_OVERRIDES.get(c, "string"), "nullable": c not in _NOT_NULL_COLUMNS}
        for c in columns
    ]


def discover(path: Path) -> list[DiscoveredEntity]:
    counts = {kind: 0 for kind in _ENTITIES}
    for kind, _ in _iter_all(path):
        counts[kind] += 1

    return [
        DiscoveredEntity(
            entity_name=kind,
            format="xml-tally-masters",
            spec={"entity": kind},
            columns=_schema_for(columns),
            sample_row_count=counts[kind],
        )
        for kind, columns in _ENTITIES.items()
    ]


def read_rows(path: Path, spec: dict[str, Any]):
    entity = spec["entity"]
    for kind, row in _iter_all(path):
        if kind == entity:
            yield {k: (v if v != "" else None) for k, v in row.items()}
