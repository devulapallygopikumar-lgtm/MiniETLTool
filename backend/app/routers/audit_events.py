from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import require_permission

router = APIRouter(prefix="/api/v1/audit-events", tags=["audit"])


@router.get(
    "", response_model=list[schemas.AuditEventOut], dependencies=[Depends(require_permission("audit:read"))]
)
def list_audit_events(db: Session = Depends(get_db)):
    rows = db.query(models.AuditEvent).order_by(models.AuditEvent.occurred_at.desc()).limit(500).all()
    labels = _labels(db, rows)
    return [
        schemas.AuditEventOut(
            id=r.id,
            occurred_at=r.occurred_at,
            actor=r.actor,
            action=r.action,
            resource_type=r.resource_type,
            resource_id=r.resource_id,
            resource_label=labels.get((r.resource_type, r.resource_id)) or _name_from_reason(r.reason),
            outcome=r.outcome,
            reason=r.reason,
        )
        for r in rows
    ]


def _labels(db: Session, rows: list[models.AuditEvent]) -> dict[tuple[str, str], str]:
    """Readable names for the resources these events point at, looked up in
    one query per type. Deleted resources simply have no entry."""
    ids: dict[str, set[str]] = {}
    for r in rows:
        ids.setdefault(r.resource_type, set()).add(r.resource_id)
    out: dict[tuple[str, str], str] = {}

    def fetch(model, type_name, label):
        if ids.get(type_name):
            for obj in db.query(model).filter(model.id.in_(ids[type_name])).all():
                out[(type_name, obj.id)] = label(obj)

    fetch(models.Dataset, "dataset", lambda d: d.name)
    fetch(models.User, "user", lambda u: u.email)
    fetch(models.Client, "client", lambda c: c.name)
    fetch(models.Domain, "domain", lambda d: d.name)
    fetch(models.ValidationRule, "rule", lambda r: f"{r.rule}{' on ' + r.column if r.column else ''}")
    fetch(models.Transform, "transform", lambda t: t.op)
    if ids.get("run"):
        from .runs import _run_number

        for run in db.query(models.Run).filter(models.Run.id.in_(ids["run"])).all():
            ds = db.get(models.Dataset, run.dataset_id)
            out[("run", run.id)] = f"{ds.name if ds else 'dataset'} — Run #{_run_number(run)}"
    return out


def _name_from_reason(reason: str | None) -> str | None:
    """Delete events record name=/email= in their reason -- the only name
    left once the resource itself is gone."""
    for part in (reason or "").split():
        for key in ("name=", "email="):
            if part.startswith(key):
                return reason.split(key, 1)[1]
    return None
