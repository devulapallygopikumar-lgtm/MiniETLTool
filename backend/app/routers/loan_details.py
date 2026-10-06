"""Loan details: a contact (name + file no) from tblmstcontact_live_loans, its
full master row, and the ledger entries that belong to it.

The contact's name / file no rarely match the Tally ledger_name exactly --
the ledgers read like "Krishnaveni.P_PL-7" or "Interest Received - Krishnaveni
PL 11" for a contact "P.Krishnaveni" / "PL-7" -- so the ledger lookup tries a
series of progressively looser comparisons and returns the rows of the first
one that matches anything (see _methods).
"""

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_permission

router = APIRouter(
    prefix="/api/v1/loan-details",
    tags=["loan-details"],
    dependencies=[Depends(require_permission("record:read"))],
)

MAX_LEDGER_ROWS = 5000

# ledger_name with case, spaces and punctuation stripped, e.g.
# "Krishnaveni.P_PL-7" -> "krishnavenippl7".
_NORM_LEDGER = "regexp_replace(lower(ledger_name), '[^a-z0-9]', '', 'g')"

# The user-specified query, with the ledger filter appended by the caller.
_LEDGER_SQL = """
select x.parent, x.ledger_name, x.date, x.voucher_number, x.voucher_type, x.line_no,
       x.amount, x.is_debit, y.narration, x.transaction_type
from (
  select * from (
    select parent, ledger_name, date, voucher_number, voucher_type, line_no,
           amount, is_debit, transaction_type, b.fyear
    from (select parent, name, fyear from tbl_mst_ledgers_22_to_26) a
    right join tbl_ledger_entries_22_to_26 b
           on b.ledger_name = a.name and a.fyear = b.fyear
  ) as a
  where parent is not null and ({condition})
) x
left join (
  select distinct voucher_number, voucher_type, narration, fyear from tbl_mst_vouchers_22_to_26
) y on x.fyear = y.fyear and x.voucher_number = y.voucher_number and x.voucher_type = y.voucher_type
order by x.date, x.voucher_number, x.ledger_name, x.line_no
limit :max_rows
"""


def _with_debit_credit(row) -> dict[str, Any]:
    """The entry plus Debit / Credit columns (right after is_debit): is_debit
    'Y' puts abs(amount) in debit, 'N' puts it in credit."""
    out: dict[str, Any] = {}
    amount = row["amount"]
    magnitude = abs(amount) if amount is not None else None
    for key, value in row.items():
        out[key] = value
        if key == "is_debit":
            flag = (value or "").strip().upper()
            out["debit"] = magnitude if flag == "Y" else None
            out["credit"] = magnitude if flag == "N" else None
            out["running_balance"] = None  # filled by _add_running_balance, keeps its place after credit
    return out


def _add_running_balance(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """running_balance = cumulative (debit - credit), in the rows' order and
    kept separately for each ledger, so a loan ledger and its interest ledger
    don't net against each other. Positive = debit balance."""
    balances: dict[str, Any] = {}
    for r in rows:
        bal = balances.get(r["ledger_name"], 0) + (r["debit"] or 0) - (r["credit"] or 0)
        balances[r["ledger_name"]] = bal
        r["running_balance"] = bal
    return rows


# Housekeeping columns of the load, not part of the loan's master data.
_HIDDEN_MASTER_COLUMNS = {"id", "run_id", "row_ordinal", "loaded_at"}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _file_pattern(file_no: str) -> str | None:
    """Regex for a file number as it appears inside a longer ledger name:
    'PL-7' matches 'Krishnaveni.P_PL-7', 'x PL 7 y' and 'PL7', but not
    'PL-70' or 'APL-7'."""
    parts = re.findall(r"[a-z]+|\d+", file_no.lower())
    if not parts:
        return None
    return r"(^|[^a-z0-9])" + r"[^a-z0-9]*".join(parts) + r"([^0-9]|$)"


def _methods(name: str, file_no: str) -> list[tuple[str, str, str, dict[str, Any]]]:
    """(key, label, SQL condition on ledger_name, bind params), strictest first."""
    name_n = _norm(name)
    file_re = _file_pattern(file_no)
    tokens = [t for t in re.findall(r"[a-z0-9]+", name.lower()) if len(t) >= 3]

    methods: list[tuple[str, str, str, dict[str, Any]]] = [
        ("exact", "Exact match", "ledger_name = :name", {"name": name}),
        (
            "ignore_case",
            "Ignoring case and surrounding spaces",
            "lower(btrim(ledger_name)) = lower(btrim(:name))",
            {"name": name},
        ),
        (
            "ignore_spaces",
            "Ignoring all spaces, dots and punctuation",
            f"{_NORM_LEDGER} = :name_n",
            {"name_n": name_n},
        ),
    ]
    if file_re and tokens:
        token_sql = " and ".join(f"{_NORM_LEDGER} like :tok{i}" for i, _ in enumerate(tokens))
        methods.append(
            (
                "file_and_name",
                "File no and every word of the name appear in the ledger name",
                f"lower(ledger_name) ~ :file_re and {token_sql}",
                {"file_re": file_re, **{f"tok{i}": f"%{t}%" for i, t in enumerate(tokens)}},
            )
        )
    if name_n:
        methods.append(
            (
                "name_contains",
                "Ledger name contains the name (spaces and punctuation ignored)",
                f"{_NORM_LEDGER} like :name_like",
                {"name_like": f"%{name_n}%"},
            )
        )
    if file_re:
        methods.append(
            (
                "file_only",
                "Ledger name contains the file no",
                "lower(ledger_name) ~ :file_re",
                {"file_re": file_re},
            )
        )
    return methods


@router.get("/contacts")
def list_contacts(db: Session = Depends(get_db)) -> list[dict[str, str]]:
    """Every (name, file_no) pair -- feeds the two linked combos."""
    try:
        rows = db.execute(
            text(
                "select name, file_no from tblmstcontact_live_loans "
                "where name is not null and file_no is not null order by name, file_no"
            )
        ).all()
    except SQLAlchemyError as exc:
        raise HTTPException(500, f"Could not read tblmstcontact_live_loans: {exc.__class__.__name__}") from exc
    return [{"name": r.name, "file_no": r.file_no} for r in rows]


@router.get("/master")
def get_master(name: str = Query(...), file_no: str = Query(...), db: Session = Depends(get_db)):
    """select * from tblmstcontact_live_loans for this contact: every column, in table order."""
    try:
        result = db.execute(
            text(
                "select * from tblmstcontact_live_loans where name = :name and file_no = :file_no "
                "order by id limit 1"
            ),
            {"name": name, "file_no": file_no},
        )
        columns = [c for c in result.keys() if c not in _HIDDEN_MASTER_COLUMNS]
        row = result.mappings().first()
    except SQLAlchemyError as exc:
        raise HTTPException(500, f"Could not read tblmstcontact_live_loans: {exc.__class__.__name__}") from exc
    if row is None:
        raise HTTPException(404, "No loan found for this name and file no.")
    return {"columns": columns, "row": {c: row[c] for c in columns}}


@router.get("/ledger")
def get_ledger(name: str = Query(...), file_no: str = Query(...), db: Session = Depends(get_db)):
    """Ledger entries for this contact, found by the first comparison method
    that matches anything. `tried` lists the stricter methods that matched nothing."""
    tried: list[dict[str, str]] = []
    try:
        for key, label, condition, params in _methods(name, file_no):
            rows = (
                db.execute(
                    text(_LEDGER_SQL.format(condition=condition)),
                    {**params, "max_rows": MAX_LEDGER_ROWS + 1},
                )
                .mappings()
                .all()
            )
            if rows:
                truncated = len(rows) > MAX_LEDGER_ROWS
                rows = rows[:MAX_LEDGER_ROWS]
                ledgers: dict[str, int] = {}
                for r in rows:
                    ledgers[r["ledger_name"]] = ledgers.get(r["ledger_name"], 0) + 1
                return {
                    "method": {"key": key, "label": label},
                    "tried": tried,
                    "ledgers": [{"name": n, "rows": c} for n, c in ledgers.items()],
                    "truncated": truncated,
                    "rows": _add_running_balance([_with_debit_credit(r) for r in rows]),
                }
            tried.append({"key": key, "label": label})
    except SQLAlchemyError as exc:
        raise HTTPException(500, f"Could not read the ledger tables: {exc.__class__.__name__}") from exc
    return {"method": None, "tried": tried, "ledgers": [], "truncated": False, "rows": []}