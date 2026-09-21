"""XML reader (ARCHITECTURE.md §4.3): streaming, never builds the whole
document tree, and treats a repeated record tag as its own entity — so
`<VOUCHER>` and nested `<LEDGER>` records fan out into two datasets, not one
(§4.5).

Real exports (Tally in particular) are not strictly well-formed: they carry
numeric character references to C0 control points (`&#4;`) that XML 1.0
disallows. `_SanitizedXMLSource` strips only those before the elements ever
reach the parser, so nothing else about the document is touched.
"""

import re
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, BinaryIO

from ..config import settings
from .base import DiscoveredEntity
from .inference import infer_schema

_CHARREF_RE = re.compile(r"&#([xX][0-9A-Fa-f]+|[0-9]+);")
_ENCODING_DECL_RE = re.compile(rb'encoding\s*=\s*"[^"]*"', re.IGNORECASE)
_TAIL_KEEP = 16


def _is_valid_xml_char(cp: int) -> bool:
    return (
        cp in (0x9, 0xA, 0xD)
        or 0x20 <= cp <= 0xD7FF
        or 0xE000 <= cp <= 0xFFFD
        or 0x10000 <= cp <= 0x10FFFF
    )


def _strip_invalid_charrefs(text: str) -> str:
    def repl(m: re.Match) -> str:
        raw = m.group(1)
        cp = int(raw[1:], 16) if raw[0] in "xX" else int(raw)
        return m.group(0) if _is_valid_xml_char(cp) else ""

    return _CHARREF_RE.sub(repl, text)


def _detect_encoding(path: Path) -> str:
    with open(path, "rb") as f:
        head = f.read(4)
    if head.startswith(b"\xff\xfe"):
        return "utf-16-le"
    if head.startswith(b"\xfe\xff"):
        return "utf-16-be"
    if head.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    return "utf-8"


class _SanitizedXMLSource:
    """A binary, read()-only stream that re-encodes the document as UTF-8
    and drops invalid numeric character references, in bounded chunks."""

    def __init__(self, path: Path, chunk_chars: int = 1 << 16):
        self._f = open(path, "r", encoding=_detect_encoding(path), errors="replace", newline="")
        self._chunk_chars = chunk_chars
        self._text_tail = ""
        self._byte_buf = b""
        self._eof = False
        self._first_chunk = True

    def _fix_encoding_decl(self, data: bytes) -> bytes:
        return _ENCODING_DECL_RE.sub(b'encoding="UTF-8"', data, count=1)

    @staticmethod
    def _safe_cut(combined: str) -> int:
        """A cut point that never splits a possible character reference.

        A fixed `len(combined) - _TAIL_KEEP` cut isn't enough on its own:
        if the '&' of a reference lands exactly as the last character
        before the cut, it has no ';' yet to its right, so the regex
        doesn't match it there — it goes out as a literal '&'. The rest
        of the reference then arrives in the *next* chunk without its
        '&', so the regex never sees the two halves together and the
        whole thing survives unstripped in the reassembled output.
        """
        cut = max(0, len(combined) - _TAIL_KEEP)
        amp = combined.rfind("&", 0, cut)
        if amp != -1 and ";" not in combined[amp:cut]:
            return amp
        return cut

    def _fill(self, min_bytes: int) -> None:
        while len(self._byte_buf) < min_bytes and not self._eof:
            chunk = self._f.read(self._chunk_chars)
            if not chunk:
                self._eof = True
                if self._text_tail:
                    cleaned = _strip_invalid_charrefs(self._text_tail).encode("utf-8")
                    if self._first_chunk:
                        cleaned = self._fix_encoding_decl(cleaned)
                        self._first_chunk = False
                    self._byte_buf += cleaned
                    self._text_tail = ""
                break
            combined = self._text_tail + chunk
            safe_len = self._safe_cut(combined)
            to_clean, self._text_tail = combined[:safe_len], combined[safe_len:]
            cleaned = _strip_invalid_charrefs(to_clean).encode("utf-8")
            if self._first_chunk:
                cleaned = self._fix_encoding_decl(cleaned)
                self._first_chunk = False
            self._byte_buf += cleaned

    def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            self._fill(1 << 30)
            size = len(self._byte_buf)
        else:
            self._fill(size)
        result, self._byte_buf = self._byte_buf[:size], self._byte_buf[size:]
        return result

    def close(self) -> None:
        self._f.close()


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _open_source(path: Path) -> BinaryIO:
    return _SanitizedXMLSource(path)  # type: ignore[return-value]


_UNSET = object()


def _discover_candidate_tags(path: Path) -> list[str]:
    """Pass 1: count tags; a repeated tag with element children is a record
    type — except a tag that is *always* a single-child passthrough around
    one other candidate (e.g. Tally's `<TALLYMESSAGE>` wrapping one
    `<VOUCHER>` each): that's a wrapper, not a distinct entity."""
    source = _open_source(path)
    counts: Counter[str] = Counter()
    has_children: defaultdict[str, bool] = defaultdict(bool)
    wrapper_child: dict[str, object] = {}
    try:
        for _, elem in ET.iterparse(source, events=("end",)):
            tag = _local(elem.tag)
            counts[tag] += 1
            children = list(elem)
            if children:
                has_children[tag] = True
            if len(children) == 1:
                child_tag = _local(children[0].tag)
                current = wrapper_child.get(tag, _UNSET)
                if current is _UNSET:
                    wrapper_child[tag] = child_tag
                elif current != child_tag:
                    wrapper_child[tag] = False
            else:
                wrapper_child[tag] = False
            # Bounds memory: emptying elem here means that when its parent
            # is itself cleared later (at the parent's own 'end' event),
            # nothing still references elem's subtree. len()/has_children
            # above already ran, so this is safe to do unconditionally.
            elem.clear()
    finally:
        source.close()

    candidates = {tag for tag, n in counts.items() if n >= 2 and has_children[tag]}
    return [tag for tag in candidates if wrapper_child.get(tag) not in candidates]


def _flatten(elem: ET.Element, skip_tags: set[str]) -> dict[str, str | None]:
    row: dict[str, str | None] = {}
    for k, v in elem.attrib.items():
        row[f"@{_local(k)}"] = v

    def walk(node: ET.Element, prefix: str) -> None:
        children = list(node)
        if not children:
            text = (node.text or "").strip()
            if text:
                key = prefix or _local(node.tag)
                row[key] = f"{row[key]}; {text}" if row.get(key) else text
            return
        for child in children:
            local = _local(child.tag)
            if local in skip_tags:
                continue
            walk(child, f"{prefix}.{local}" if prefix else local)

    walk(elem, "")
    return row


def _iter_records(path: Path, record_tag: str, skip_tags: set[str]):
    """Pass helper: stream the whole document, yielding a flattened dict for
    each closed element matching record_tag, while keeping memory bounded.

    Only record_tag elements are cleared, right after they're flattened —
    clearing a descendant on its own 'end' would wipe its text before the
    record's flatten ever reads it. Clearing the record element once its
    subtree has been consumed drops every reference to that subtree anyway
    (its own children included), so nothing extra is needed."""
    source = _open_source(path)
    try:
        for _, elem in ET.iterparse(source, events=("end",)):
            if _local(elem.tag) == record_tag:
                yield _flatten(elem, skip_tags)
                elem.clear()
    finally:
        source.close()


def discover(path: Path) -> list[DiscoveredEntity]:
    candidates = _discover_candidate_tags(path)
    if not candidates:
        return []

    samples: dict[str, list[dict]] = {tag: [] for tag in candidates}
    columns: dict[str, list[str]] = {tag: [] for tag in candidates}
    counts: Counter[str] = Counter()

    for tag in candidates:
        skip_tags = set(candidates) - {tag}
        for row in _iter_records(path, tag, skip_tags):
            counts[tag] += 1
            if len(samples[tag]) < settings.schema_sample_rows:
                samples[tag].append(row)
                for k in row:
                    if k not in columns[tag]:
                        columns[tag].append(k)

    entities = []
    for tag in candidates:
        schema = infer_schema(samples[tag], columns[tag])
        entities.append(
            DiscoveredEntity(
                entity_name=tag,
                format="xml",
                spec={
                    "record_tag": tag,
                    "skip_tags": sorted(set(candidates) - {tag}),
                    "columns": columns[tag],
                },
                columns=schema,
                sample_row_count=counts[tag],
            )
        )
    return entities


def read_rows(path: Path, spec: dict[str, Any]):
    record_tag = spec["record_tag"]
    skip_tags = set(spec["skip_tags"])
    columns: list[str] = spec["columns"]
    for row in _iter_records(path, record_tag, skip_tags):
        yield {col: row.get(col) for col in columns}
