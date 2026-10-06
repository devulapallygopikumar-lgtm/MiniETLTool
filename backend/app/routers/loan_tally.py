"""Tally a loan: compare the Principal Outstanding given in the master data
with the running balance of the loan's ledger entries, row by row, and keep
the outcome -- one row per file no -- in the table tmp_loan_tally.

Reuses loan_details' master/ledger lookups unchanged (same name matching,
same Debit/Credit/Running balance), so what is compared is exactly what the
Loan details grid shows: every row of every matched ledger, each with its own
ledger's running balance.

Outcome per file no:
  - a row whose running balance equals Principal Outstanding exists
      -> Tallied; Ledger Date / Running Total are that row's (the latest one
         if several match); Difference = 0
  - none equals it
      -> Not Tallied; Ledger Date / Running Total are the row whose balance
         is closest (the latest on a tie); Difference = Principal
         Outstanding - Running Total
  - no ledger rows at all, or no Principal Outstanding
      -> Not Tallied with the unknown fields empty
"""

import threading
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..database import SessionLocal, get_db
from ..deps import require_permission
from . import loan_details

router = APIRouter(
    prefix="/api/v1/loan-tally",
    tags=["loan-tally"],
    dependencies=[Depends(require_permission("record:read"))],
)

TABLE = "tmp_loan_tally"
_CENT = Decimal("0.01")

_CREATE_SQL = f"""
create table if not exists {TABLE} (
    id bigserial primary key,
    file_no text not null,
    name text not null,
    principal_outstanding numeric,
    ledger_date date,
    running_total numeric,
    difference numeric,
    status text not null,
    tallied_at timestamptz not null default now()
)
"""


class TallyRequest(BaseModel):
    name: str
    file_no: str


def _money(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value)).quantize(_CENT)
    except InvalidOperation:
        return None


def compare(principal: Decimal | None, rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Pure comparison -- see the module docstring for the rules. `rows` are
    the ledger rows in grid order (date, voucher number...)."""
    candidates = [
        (r["date"], total) for r in rows if (total := _money(r.get("running_balance"))) is not None
    ]
    if principal is None or not candidates:
        return {"ledger_date": None, "running_total": None, "difference": None, "status": "Not Tallied"}
    principal = principal.quantize(_CENT)

    # Closest balance wins; on a tie, the later row (candidates are in date order).
    best_date, best_total = candidates[0]
    best_gap = abs(principal - best_total)
    for d, total in candidates[1:]:
        gap = abs(principal - total)
        if gap <= best_gap:
            best_date, best_total, best_gap = d, total, gap

    difference = principal - best_total
    return {
        "ledger_date": best_date,
        "running_total": best_total,
        "difference": difference,
        "status": "Tallied" if difference == 0 else "Not Tallied",
    }


def _stored_rows(db: Session) -> list[dict[str, Any]]:
    return [
        dict(r)
        for r in db.execute(
            text(
                f"select file_no, name, principal_outstanding, ledger_date, running_total, difference, "
                f"status, tallied_at from {TABLE} order by file_no, id"
            )
        ).mappings()
    ]


@router.get("")
def list_tallies(db: Session = Depends(get_db)):
    """Every stored tally, by file no (one row per file no)."""
    try:
        db.execute(text(_CREATE_SQL))
        db.commit()
        return {"rows": _stored_rows(db)}
    except SQLAlchemyError as exc:
        raise HTTPException(500, f"Could not read {TABLE}: {exc.__class__.__name__}") from exc


def _store(db: Session, name: str, file_no: str, principal: Decimal | None, result: dict[str, Any]) -> None:
    """Replace this file no's row in tmp_loan_tally (caller commits)."""
    db.execute(text(f"delete from {TABLE} where file_no = :file_no"), {"file_no": file_no})
    db.execute(
        text(
            f"insert into {TABLE} (file_no, name, principal_outstanding, ledger_date, running_total, "
            f"difference, status) values (:file_no, :name, :principal, :ledger_date, :running_total, "
            f":difference, :status)"
        ),
        {
            "file_no": file_no,
            "name": name,
            "principal": principal,
            "ledger_date": result["ledger_date"],
            "running_total": result["running_total"],
            "difference": result["difference"],
            "status": result["status"],
        },
    )


def _tally_one(db: Session, name: str, file_no: str) -> tuple[Decimal | None, dict[str, Any]]:
    """What the Show button does for one loan (master data + ledger entries),
    then the comparison. Returns (principal outstanding, comparison)."""
    master = loan_details.get_master(name=name, file_no=file_no, db=db)
    ledger = loan_details.get_ledger(name=name, file_no=file_no, db=db)
    principal = _money(master["row"].get("principal_outstanding"))
    return principal, compare(principal, ledger["rows"])


@router.post("")
def tally(body: TallyRequest, db: Session = Depends(get_db)):
    """Tally one loan and replace its row in tmp_loan_tally; returns the
    stored tallies (by file no), `current` being the file no just tallied."""
    principal, result = _tally_one(db, body.name, body.file_no)
    try:
        db.execute(text(_CREATE_SQL))
        _store(db, body.name, body.file_no, principal, result)
        db.commit()
        rows = _stored_rows(db)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(500, f"Could not write {TABLE}: {exc.__class__.__name__}") from exc

    return {"current": body.file_no, "rows": rows}


# ---- Tally everything ("Tally All") ----
#
# One click tallies every loan in
#     select name, file_no from tblmstcontact_live_loans order by file_no
# as a background job (a few seconds per ten loans), so the page can show
# progress instead of waiting on one long request. The results table is
# dropped and recreated at the start, so it holds exactly this run.

_CONTACTS_SQL = "select name, file_no from tblmstcontact_live_loans order by file_no"

_job_lock = threading.Lock()
_job: dict[str, Any] = {
    "running": False,
    "total": 0,
    "done": 0,
    "failed": 0,
    "current": None,
    "started_at": None,
    "finished_at": None,
}


def _run_all() -> None:
    db = SessionLocal()
    try:
        contacts = db.execute(text(_CONTACTS_SQL)).all()
        db.execute(text(f"drop table if exists {TABLE}"))
        db.execute(text(_CREATE_SQL))
        db.commit()
        with _job_lock:
            _job["total"] = len(contacts)

        for name, file_no in contacts:
            with _job_lock:
                _job["current"] = file_no
            try:
                principal, result = _tally_one(db, name, file_no)
            except Exception:  # noqa: BLE001 - one bad loan must not stop the others
                db.rollback()
                principal = None
                result = {"ledger_date": None, "running_total": None, "difference": None, "status": "Not Tallied"}
                with _job_lock:
                    _job["failed"] += 1
            _store(db, name or "", file_no or "", principal, result)
            db.commit()
            with _job_lock:
                _job["done"] += 1
    except Exception:  # noqa: BLE001
        db.rollback()
        with _job_lock:
            _job["failed"] += 1
    finally:
        db.close()
        with _job_lock:
            _job["running"] = False
            _job["current"] = None
            _job["finished_at"] = datetime.now(timezone.utc).isoformat()


@router.post("/run-all", status_code=202)
def start_run_all():
    """Start tallying every loan. 409 if a run is already going."""
    with _job_lock:
        if _job["running"]:
            raise HTTPException(409, "A tally run is already in progress.")
        _job.update(
            running=True,
            total=0,
            done=0,
            failed=0,
            current=None,
            started_at=datetime.now(timezone.utc).isoformat(),
            finished_at=None,
        )
    threading.Thread(target=_run_all, name="loan-tally", daemon=True).start()
    return dict(_job)


@router.get("/status")
def run_status():
    with _job_lock:
        return dict(_job)


# ---- Verification report ----
#
# Every stored tally with its ledger entries, for printing: one section per
# file no / name. Ledger rows are the same ones the Loan details grid shows.

_REPORT_STATUSES = {"all", "Tallied", "Not Tallied"}


@router.get("/report")
def report(status: str = "all", db: Session = Depends(get_db)):
    """The stored tallies (by file no) with each loan's ledger entries.
    `status` filters to Tallied or Not Tallied; the default is every loan."""
    if status not in _REPORT_STATUSES:
        raise HTTPException(422, "status must be all, Tallied or Not Tallied")
    try:
        db.execute(text(_CREATE_SQL))
        db.commit()
        tallies = [t for t in _stored_rows(db) if status == "all" or t["status"] == status]
    except SQLAlchemyError as exc:
        raise HTTPException(500, f"Could not read {TABLE}: {exc.__class__.__name__}") from exc

    loans = []
    for t in tallies:
        try:
            ledger = loan_details.get_ledger(name=t["name"], file_no=t["file_no"], db=db)
            entries, ledgers = ledger["rows"], ledger["ledgers"]
        except Exception:  # noqa: BLE001 - one unreadable loan must not sink the report
            db.rollback()
            entries, ledgers = [], []
        loans.append({**t, "ledgers": ledgers, "entries": entries})
    return {"status": status, "loans": loans}
