import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import audit, models, schemas
from ..database import get_db
from ..deps import get_current_user, require_maker_checker, require_permission
from ..runner import execute_run, execute_run_after_approval
from .datasets import get_dataset_or_404

router = APIRouter(
    prefix="/api/v1", tags=["runs"], dependencies=[Depends(require_permission("batch:read"))]
)


def _run_out(run: models.Run, dataset_name: str) -> schemas.RunOut:
    return schemas.RunOut(
        id=run.id,
        dataset_id=run.dataset_id,
        dataset_name=dataset_name,
        state=run.state,
        gate_state=run.gate_state,
        created_at=run.created_at,
        started_at=run.started_at,
        finished_at=run.finished_at,
        rows_read=run.rows_read,
        rows_written=run.rows_written,
        rows_rejected=run.rows_rejected,
        error=run.error,
        created_by=run.created_by,
        approved_by=run.approved_by,
        approved_at=run.approved_at,
    )


def _get_run_or_404(db: Session, run_id: str) -> models.Run:
    run = db.get(models.Run, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    return run


@router.post(
    "/datasets/{dataset_id}/run",
    response_model=schemas.RunOut,
    dependencies=[Depends(require_permission("batch:upload"))],
)
def start_run(
    dataset_id: str,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(get_current_user),  # decorator-level dependency already checked the permission
    db: Session = Depends(get_db),
):
    dataset = get_dataset_or_404(db, dataset_id)
    mapping = dataset.mapping
    if mapping is None:
        raise HTTPException(409, "Dataset has no mapping")

    run = models.Run(
        dataset_id=dataset.id,
        mapping_id=mapping.id,
        mapping_version=mapping.version,
        state="queued",
        gate_state="pending",
        created_by=current_user.id,
    )
    db.add(run)
    db.flush()
    dataset.latest_run_id = run.id
    audit.log(db, "run.started", "run", run.id)
    db.commit()
    db.refresh(run)

    background_tasks.add_task(execute_run, run.id)
    return _run_out(run, dataset.name)


@router.post(
    "/runs/{run_id}/approve",
    response_model=schemas.RunOut,
    dependencies=[Depends(require_permission("batch:approve"))],
)
def approve_run(
    run_id: str,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(get_current_user),  # decorator-level dependency already checked the permission
    db: Session = Depends(get_db),
):
    run = _get_run_or_404(db, run_id)
    require_maker_checker(current_user, run.created_by)
    if run.state != "awaiting_approval":
        raise HTTPException(409, f"Run is '{run.state}', not awaiting approval")

    dataset = db.get(models.Dataset, run.dataset_id)
    run.approved_by = current_user.id
    run.approved_at = datetime.now(timezone.utc)
    run.state = "approved"
    if dataset is not None:
        dataset.state = "approved"
    audit.log(db, "run.approved", "run", run.id)
    db.commit()
    db.refresh(run)

    background_tasks.add_task(execute_run_after_approval, run.id)
    return _run_out(run, dataset.name if dataset else "")


@router.get("/datasets/{dataset_id}/runs", response_model=list[schemas.RunOut])
def list_runs(dataset_id: str, db: Session = Depends(get_db)):
    dataset = get_dataset_or_404(db, dataset_id)
    rows = (
        db.query(models.Run)
        .filter_by(dataset_id=dataset_id)
        .order_by(models.Run.created_at.desc())
        .all()
    )
    return [_run_out(r, dataset.name) for r in rows]


@router.get("/runs/{run_id}", response_model=schemas.RunOut)
def get_run(run_id: str, db: Session = Depends(get_db)):
    run = _get_run_or_404(db, run_id)
    dataset = db.get(models.Dataset, run.dataset_id)
    return _run_out(run, dataset.name if dataset else "")


@router.get("/runs/{run_id}/validation", response_model=schemas.RunValidationOut)
def get_run_validation(run_id: str, db: Session = Depends(get_db)):
    run = _get_run_or_404(db, run_id)
    results = db.query(models.ValidationResult).filter_by(run_id=run_id).all()
    if not results and run.state in ("queued", "running"):
        raise HTTPException(404, "Validation results not available yet")
    return schemas.RunValidationOut(
        gate_state=run.gate_state,
        results=[
            schemas.ValidationResultOut(
                rule_id=r.rule_id,
                scope=r.scope,
                column=r.column,
                rule=r.rule,
                enforcement=r.enforcement,
                violations=r.violations,
                rows_checked=r.rows_checked,
                pass_rate=r.pass_rate,
            )
            for r in results
        ],
    )


@router.get("/runs/{run_id}/validation/{rule_id}/rows", response_model=list[schemas.ValidationIssueRowOut])
def get_run_validation_rows(run_id: str, rule_id: str, db: Session = Depends(get_db)):
    _get_run_or_404(db, run_id)
    issues = db.query(models.ValidationIssue).filter_by(run_id=run_id, rule_id=rule_id).all()
    return [
        schemas.ValidationIssueRowOut(
            row_ordinal=i.row_ordinal,
            column_name=i.column_name,
            offending_value=i.offending_value,
            message=i.message,
        )
        for i in issues
    ]


@router.get("/runs/{run_id}/rejects")
def download_rejects(run_id: str, db: Session = Depends(get_db)):
    _get_run_or_404(db, run_id)
    rows = (
        db.query(models.RejectedRow)
        .filter_by(run_id=run_id)
        .order_by(models.RejectedRow.row_ordinal)
        .all()
    )

    columns: list[str] = []
    seen: set[str] = set()
    for r in rows:
        for k in r.data_json.keys():
            if k not in seen:
                seen.add(k)
                columns.append(k)

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=["row_ordinal", "reason", *columns])
    writer.writeheader()
    for r in rows:
        writer.writerow({"row_ordinal": r.row_ordinal, "reason": r.reason, **r.data_json})

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="run-{run_id}-rejects.csv"'},
    )
