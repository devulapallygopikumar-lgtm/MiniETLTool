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
    return [
        schemas.AuditEventOut(
            id=r.id,
            occurred_at=r.occurred_at,
            actor=r.actor,
            action=r.action,
            resource_type=r.resource_type,
            resource_id=r.resource_id,
            outcome=r.outcome,
            reason=r.reason,
        )
        for r in rows
    ]
