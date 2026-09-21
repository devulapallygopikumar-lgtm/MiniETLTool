"""Tally voucher export reader (source format `xml-tally`).

Auto-selected in place of the generic `xml_reader` (§4.3's tag-frequency
heuristic) when a file looks like a Tally export — it has both `VOUCHER`
and `TALLYMESSAGE` tags. Where the generic reader flattens whatever
structure it finds, this one knows Tally's shape and produces three
curated entities with the same column layout the original `parse_tally.py`
extraction script used, because that layout *is* the clear view of a
transaction: `vouchers` (header fields), `ledger_entries` (the debit/credit
lines, with the ISDEEMEDPOSITIVE sign convention resolved into `is_debit`
and bank allocations folded in), and `bill_allocations` (bill-wise refs).

It reuses `xml_reader`'s sanitizing stream (`_open_source`) rather than
`parse_tally.py`'s own per-chunk regex — that regex stripped illegal
`&#4;`-style character references chunk-by-chunk with no boundary
handling, so a reference split across a chunk edge would reach the parser
unstripped. The shared stream buffers a small tail across chunks
specifically to avoid that, and also drops any invalid character
reference (not just the C0-control ones the hand-rolled regex enumerated),
and sniffs encoding instead of assuming UTF-16.
"""

import xml.etree.ElementTree as ET
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from typing import Any

from .base import DiscoveredEntity
from .xml_reader import _local, _open_source

VOUCHER_COLUMNS = [
    "guid", "voucher_key", "date", "effective_date", "voucher_type",
    "voucher_number", "reference", "reference_date", "party_ledger",
    "narration", "state", "place_of_supply", "is_cancelled",
    "is_optional", "is_deleted", "alter_id", "master_id",
]
LEDGER_COLUMNS = [
    "guid", "voucher_number", "date", "voucher_type", "line_no",
    "ledger_name", "amount", "is_debit", "is_party_ledger",
    "bank_date", "instrument_no", "transaction_type",
]
BILL_COLUMNS = ["guid", "ledger_name", "bill_name", "bill_type", "amount"]

_ENTITIES = {
    "vouchers": VOUCHER_COLUMNS,
    "ledger_entries": LEDGER_COLUMNS,
    "bill_allocations": BILL_COLUMNS,
}

_TYPE_OVERRIDES = {
    "date": "date", "effective_date": "date", "reference_date": "date", "bank_date": "date",
    "amount": "number", "line_no": "integer",
}
_NOT_NULL_COLUMNS = {"guid", "ledger_name"}


def looks_like_tally(path: Path, sniff_bytes: int = 262_144) -> bool:
    try:
        with open(path, "rb") as f:
            head = f.read(sniff_bytes)
    except OSError:
        return False
    text = head.decode("utf-16", errors="ignore") + head.decode("utf-8", errors="ignore")
    return "TALLYMESSAGE" in text and "<VOUCHER" in text


def _text(el: ET.Element | None, tag: str, default: str = "") -> str:
    if el is None:
        return default
    child = el.find(tag)
    if child is None or child.text is None:
        return default
    return child.text.strip()


def _ymd(s: str) -> str:
    try:
        return datetime.strptime(s, "%Y%m%d").date().isoformat()
    except ValueError:
        return s


def _iter_vouchers(path: Path) -> Iterator[ET.Element]:
    source = _open_source(path)
    try:
        for _, elem in ET.iterparse(source, events=("end",)):
            if _local(elem.tag) == "VOUCHER":
                yield elem
                elem.clear()
    finally:
        source.close()


def _iter_all(path: Path) -> Iterator[tuple[str, dict[str, str]]]:
    for v in _iter_vouchers(path):
        guid = _text(v, "GUID")
        vnum = _text(v, "VOUCHERNUMBER")
        vdate = _ymd(_text(v, "DATE"))
        vtype = v.get("VCHTYPE") or _text(v, "VOUCHERTYPENAME")

        yield "vouchers", {
            "guid": guid,
            "voucher_key": _text(v, "VOUCHERKEY"),
            "date": vdate,
            "effective_date": _ymd(_text(v, "EFFECTIVEDATE")),
            "voucher_type": vtype,
            "voucher_number": vnum,
            "reference": _text(v, "REFERENCE"),
            "reference_date": _ymd(_text(v, "REFERENCEDATE")),
            "party_ledger": _text(v, "PARTYLEDGERNAME"),
            "narration": _text(v, "NARRATION"),
            "state": _text(v, "STATENAME"),
            "place_of_supply": _text(v, "PLACEOFSUPPLY"),
            "is_cancelled": _text(v, "ISCANCELLED"),
            "is_optional": _text(v, "ISOPTIONAL"),
            "is_deleted": _text(v, "ISDELETED"),
            "alter_id": _text(v, "ALTERID"),
            "master_id": _text(v, "MASTERID"),
        }

        for i, le in enumerate(v.findall("ALLLEDGERENTRIES.LIST"), 1):
            bank = le.find("BANKALLOCATIONS.LIST")
            yield "ledger_entries", {
                "guid": guid,
                "voucher_number": vnum,
                "date": vdate,
                "voucher_type": vtype,
                "line_no": str(i),
                "ledger_name": _text(le, "LEDGERNAME"),
                "amount": _text(le, "AMOUNT"),
                # Tally: ISDEEMEDPOSITIVE=Yes => debit (amount is negative)
                "is_debit": "Y" if _text(le, "ISDEEMEDPOSITIVE") == "Yes" else "N",
                "is_party_ledger": _text(le, "ISPARTYLEDGER"),
                "bank_date": _ymd(_text(bank, "TRANSACTIONDATE")) if bank is not None else "",
                "instrument_no": _text(bank, "INSTRUMENTNUMBER"),
                "transaction_type": _text(bank, "TRANSACTIONTYPE"),
            }

            for ba in le.findall("BILLALLOCATIONS.LIST"):
                name = _text(ba, "NAME")
                if not name:
                    continue
                yield "bill_allocations", {
                    "guid": guid,
                    "ledger_name": _text(le, "LEDGERNAME"),
                    "bill_name": name,
                    "bill_type": _text(ba, "BILLTYPE"),
                    "amount": _text(ba, "AMOUNT"),
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
            format="xml-tally",
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
