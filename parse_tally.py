#!/usr/bin/env python3
"""
Stream-parse a Tally voucher export (Transactions.xml) into flat CSVs.

Handles the three things that break naive parsers on Tally exports:
  1. UTF-16LE encoding with BOM  -> decode incrementally, don't read() 146 MB
  2. Illegal char refs like &#4; -> XML 1.0 forbids them; strip before parsing
  3. Size                        -> XMLPullParser + clear(), constant memory

Output:
  vouchers.csv       one row per voucher (header fields)
  ledger_entries.csv one row per ALLLEDGERENTRIES.LIST line (the debits/credits)
  bill_allocations.csv  bill-wise refs, where present
"""

import codecs
import csv
import re
import sys
from datetime import datetime
from xml.etree.ElementTree import XMLPullParser

SRC = sys.argv[1] if len(sys.argv) > 1 else "/mnt/user-data/uploads/Transactions.xml"

# XML 1.0 allows only tab, LF, CR and >= 0x20. Tally emits &#4; as a "logical
# field separator" inside values like "&#4; Not Applicable". Drop those refs.
BAD_REF = re.compile(r"&#(?:0*(?:[0-8]|1[124-9]|2[0-9]|3[01])|x0*(?:[0-8]|[bcefBCEF]|1[0-9a-fA-F]));")


def text(el, tag, default=""):
    child = el.find(tag)
    if child is None or child.text is None:
        return default
    return child.text.strip()


def ymd(s):
    """Tally dates are YYYYMMDD."""
    try:
        return datetime.strptime(s, "%Y%m%d").date().isoformat()
    except (ValueError, TypeError):
        return s


def num(s):
    """AMOUNT is a signed decimal string; negative = debit in Tally's convention."""
    s = (s or "").strip()
    return s if s else ""


def vouchers(path, chunk_chars=1 << 20):
    """Yield each <VOUCHER> element, then free it."""
    parser = XMLPullParser(events=("end",))
    reader = codecs.getreader("utf-16")(open(path, "rb"))
    while True:
        chunk = reader.read(chunk_chars)
        if not chunk:
            break
        parser.feed(BAD_REF.sub("", chunk))
        for _, el in parser.read_events():
            if el.tag == "VOUCHER":
                yield el
                el.clear()
    parser.close()
    for _, el in parser.read_events():
        if el.tag == "VOUCHER":
            yield el
            el.clear()


V_COLS = ["guid", "voucher_key", "date", "effective_date", "voucher_type",
          "voucher_number", "reference", "reference_date", "party_ledger",
          "narration", "state", "place_of_supply", "is_cancelled",
          "is_optional", "is_deleted", "alter_id", "master_id"]

L_COLS = ["guid", "voucher_number", "date", "voucher_type", "line_no",
          "ledger_name", "amount", "is_debit", "is_party_ledger",
          "bank_date", "instrument_no", "transaction_type"]

B_COLS = ["guid", "ledger_name", "bill_name", "bill_type", "amount"]


def main():
    fv = open("vouchers.csv", "w", newline="", encoding="utf-8")
    fl = open("ledger_entries.csv", "w", newline="", encoding="utf-8")
    fb = open("bill_allocations.csv", "w", newline="", encoding="utf-8")
    wv, wl, wb = (csv.DictWriter(f, c) for f, c in
                  ((fv, V_COLS), (fl, L_COLS), (fb, B_COLS)))
    for w in (wv, wl, wb):
        w.writeheader()

    n_v = n_l = 0
    for v in vouchers(SRC):
        guid = text(v, "GUID")
        vnum = text(v, "VOUCHERNUMBER")
        vdate = ymd(text(v, "DATE"))
        vtype = v.get("VCHTYPE") or text(v, "VOUCHERTYPENAME")

        wv.writerow({
            "guid": guid,
            "voucher_key": text(v, "VOUCHERKEY"),
            "date": vdate,
            "effective_date": ymd(text(v, "EFFECTIVEDATE")),
            "voucher_type": vtype,
            "voucher_number": vnum,
            "reference": text(v, "REFERENCE"),
            "reference_date": ymd(text(v, "REFERENCEDATE")),
            "party_ledger": text(v, "PARTYLEDGERNAME"),
            "narration": text(v, "NARRATION"),
            "state": text(v, "STATENAME"),
            "place_of_supply": text(v, "PLACEOFSUPPLY"),
            "is_cancelled": text(v, "ISCANCELLED"),
            "is_optional": text(v, "ISOPTIONAL"),
            "is_deleted": text(v, "ISDELETED"),
            "alter_id": text(v, "ALTERID"),
            "master_id": text(v, "MASTERID"),
        })
        n_v += 1

        for i, le in enumerate(v.findall("ALLLEDGERENTRIES.LIST"), 1):
            bank = le.find("BANKALLOCATIONS.LIST")
            wl.writerow({
                "guid": guid,
                "voucher_number": vnum,
                "date": vdate,
                "voucher_type": vtype,
                "line_no": i,
                "ledger_name": text(le, "LEDGERNAME"),
                "amount": num(text(le, "AMOUNT")),
                # Tally: ISDEEMEDPOSITIVE=Yes  => debit (amount is negative)
                "is_debit": "Y" if text(le, "ISDEEMEDPOSITIVE") == "Yes" else "N",
                "is_party_ledger": text(le, "ISPARTYLEDGER"),
                "bank_date": ymd(text(bank, "TRANSACTIONDATE")) if bank is not None else "",
                "instrument_no": text(bank, "INSTRUMENTNUMBER") if bank is not None else "",
                "transaction_type": text(bank, "TRANSACTIONTYPE") if bank is not None else "",
            })
            n_l += 1

            for ba in le.findall("BILLALLOCATIONS.LIST"):
                name = text(ba, "NAME")
                if not name:
                    continue
                wb.writerow({
                    "guid": guid,
                    "ledger_name": text(le, "LEDGERNAME"),
                    "bill_name": name,
                    "bill_type": text(ba, "BILLTYPE"),
                    "amount": num(text(ba, "AMOUNT")),
                })

    for f in (fv, fl, fb):
        f.close()
    print(f"{n_v} vouchers, {n_l} ledger entries")


if __name__ == "__main__":
    main()
