"""Destructive, whole-system actions with no dataset-scoped equivalent.
Single-user slice, no auth (§20.5) -- the frontend gates this behind an
explicit yes/no confirmation before ever calling it."""

from fastapi import APIRouter, Depends
from sqlalchemy import text as sa_text
from sqlalchemy.orm import Session

from .. import audit, models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


@router.post("/reset", response_model=schemas.ResetSummary)
def reset_everything(db: Session = Depends(get_db)):
    """Deletes every dataset, mapping, rule, transform, run and audit event
    (and every row/table they produced) -- a genuinely empty system. Logs
    one fresh system.reset event afterward, so there's still a record that
    a reset happened and when."""
    dataset_count = db.query(models.Dataset).count()
    for (table,) in db.query(models.Mapping.target_table).all():
        db.execute(sa_text(f'DROP TABLE IF EXISTS "{table}"'))

    summary = schemas.ResetSummary(
        datasets=dataset_count,
        mappings=db.query(models.Mapping).count(),
        rules=db.query(models.ValidationRule).count(),
        transforms=db.query(models.Transform).count(),
        runs=db.query(models.Run).count(),
        staging_rows=db.query(models.StagingRow).count(),
        rejected_rows=db.query(models.RejectedRow).count(),
        validation_results=db.query(models.ValidationResult).count(),
        validation_issues=db.query(models.ValidationIssue).count(),
        loaded_rows=db.query(models.LoadedRow).count(),
        audit_events=db.query(models.AuditEvent).count(),
    )

    db.query(models.ValidationIssue).delete()
    db.query(models.ValidationResult).delete()
    db.query(models.LoadedRow).delete()
    db.query(models.RejectedRow).delete()
    db.query(models.StagingRow).delete()
    db.query(models.Run).delete()
    db.query(models.Transform).delete()
    db.query(models.ValidationRule).delete()
    db.query(models.Mapping).delete()
    db.query(models.Dataset).delete()
    db.query(models.AuditEvent).delete()

    audit.log(db, "system.reset", "system", "all", reason=f"{summary.datasets} dataset(s) deleted")
    db.commit()
    return summary
