"""Destructive, whole-system actions with no dataset-scoped equivalent.
Single-user slice, no auth (§20.5) -- the frontend gates this behind an
explicit yes/no confirmation before ever calling it."""

from fastapi import APIRouter, Depends
from sqlalchemy import text as sa_text
from sqlalchemy.orm import Session

from .. import audit, models, schemas, target_tables
from ..database import get_db

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


@router.post("/reset", response_model=schemas.ResetSummary)
def reset_everything(db: Session = Depends(get_db)):
    """Deletes every dataset, mapping, rule, transform and run (and every
    row/table they produced), back to an empty system. The audit log is
    append-only and is left untouched, aside from the event this logs."""
    dataset_ids = [d.id for d in db.query(models.Dataset.id).all()]
    for dataset_id in dataset_ids:
        table = target_tables.physical_table_name(dataset_id)
        db.execute(sa_text(f'DROP TABLE IF EXISTS "{table}"'))

    summary = schemas.ResetSummary(
        datasets=len(dataset_ids),
        mappings=db.query(models.Mapping).count(),
        rules=db.query(models.ValidationRule).count(),
        transforms=db.query(models.Transform).count(),
        runs=db.query(models.Run).count(),
        staging_rows=db.query(models.StagingRow).count(),
        rejected_rows=db.query(models.RejectedRow).count(),
        validation_results=db.query(models.ValidationResult).count(),
        validation_issues=db.query(models.ValidationIssue).count(),
        loaded_rows=db.query(models.LoadedRow).count(),
    )

    audit.log(db, "system.reset", "system", "all", reason=f"{summary.datasets} dataset(s) deleted")

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

    db.commit()
    return summary
