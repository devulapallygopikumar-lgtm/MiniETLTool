from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import text as sa_text
from sqlalchemy.orm import Session, object_session

from .. import audit, derived, models, schemas
from ..database import get_db
from ..deps import can_access_dataset, get_current_user, require_permission
from ..readers.base import read_rows

router = APIRouter(
    prefix="/api/v1/datasets",
    tags=["datasets"],
    dependencies=[Depends(require_permission("product:read"))],
)

_PREVIEW_MAX = 500


def to_out(d: models.Dataset) -> schemas.DatasetOut:
    return schemas.DatasetOut(
        id=d.id,
        name=d.name,
        source_filename=d.source_filename,
        format=d.format,
        entity_name=d.entity_name,
        state=d.state,
        gate_state=d.gate_state,
        row_count=d.row_count,
        preview_row_count=d.preview_row_count,
        columns=[schemas.SchemaColumn(**c) for c in d.columns_json],
        created_at=d.created_at,
        latest_run_id=d.latest_run_id,
        created_by=d.created_by,
        client_id=d.client_id,
        client_name=d.client.name if d.client else None,
        domain_id=d.client.domain_id if d.client else None,
        domain_name=d.client.domain.name if d.client else None,
        deleted_at=d.deleted_at,
        latest_rows_read=_latest_rows_read(d),
    )


def _latest_rows_read(d: models.Dataset) -> int | None:
    """Rows the latest run read from the source -- a count that exists
    before anything is loaded (row_count stays NULL until a load)."""
    session = object_session(d)
    if not d.latest_run_id or session is None:
        return None
    run = session.get(models.Run, d.latest_run_id)
    return run.rows_read if run else None


def get_dataset_or_404(db: Session, dataset_id: str, user: models.User) -> models.Dataset:
    dataset = db.get(models.Dataset, dataset_id)
    # 404, not 403: don't reveal that someone else's dataset exists.
    if dataset is None or dataset.deleted_at is not None or not can_access_dataset(user, dataset):
        raise HTTPException(404, "Dataset not found")
    return dataset


def _get_trashed_or_404(db: Session, dataset_id: str) -> models.Dataset:
    dataset = db.get(models.Dataset, dataset_id)
    if dataset is None or dataset.deleted_at is None:
        raise HTTPException(404, "Dataset not found in the Trash")
    return dataset


@router.get("", response_model=list[schemas.DatasetOut])
def list_datasets(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    query = db.query(models.Dataset).filter(models.Dataset.deleted_at.is_(None))
    if current_user.role != "admin":
        query = query.join(models.Client, models.Dataset.client_id == models.Client.id).filter(
            models.Client.domain_id == current_user.domain_id
        )
    rows = query.order_by(models.Dataset.created_at.desc()).all()
    return [to_out(d) for d in rows]


_can_delete = [Depends(require_permission("dataset:delete"))]


@router.get("/trash", response_model=list[schemas.DatasetOut], dependencies=_can_delete)
def list_trash(db: Session = Depends(get_db)):
    rows = (
        db.query(models.Dataset)
        .filter(models.Dataset.deleted_at.is_not(None))
        .order_by(models.Dataset.deleted_at.desc())
        .all()
    )
    return [to_out(d) for d in rows]


@router.get("/{dataset_id}", response_model=schemas.DatasetOut)
def get_dataset(dataset_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    return to_out(get_dataset_or_404(db, dataset_id, current_user))


@router.post("/trash/empty", dependencies=_can_delete)
def empty_trash(db: Session = Depends(get_db)):
    """Permanently drops everything currently in the Trash."""
    rows = db.query(models.Dataset).filter(models.Dataset.deleted_at.is_not(None)).all()
    for dataset in rows:
        _drop_for_good(db, dataset)
    db.commit()
    return {"dropped": len(rows)}


@router.delete("/{dataset_id}", status_code=204, dependencies=_can_delete)
def trash_dataset(dataset_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """Moves a dataset to the Trash: hidden everywhere and restorable, but
    its table and rows are kept until it is dropped permanently."""
    dataset = get_dataset_or_404(db, dataset_id, current_user)
    dataset.deleted_at = datetime.now(timezone.utc)
    audit.log(db, "dataset.trashed", "dataset", dataset_id, reason=f"name={dataset.name}")
    db.commit()
    return Response(status_code=204)


@router.post("/{dataset_id}/restore", response_model=schemas.DatasetOut, dependencies=_can_delete)
def restore_dataset(dataset_id: str, db: Session = Depends(get_db)):
    dataset = _get_trashed_or_404(db, dataset_id)
    dataset.deleted_at = None
    audit.log(db, "dataset.restored", "dataset", dataset_id, reason=f"name={dataset.name}")
    db.commit()
    db.refresh(dataset)
    return to_out(dataset)


@router.delete("/{dataset_id}/permanent", status_code=204, dependencies=_can_delete)
def drop_dataset_permanently(dataset_id: str, db: Session = Depends(get_db)):
    """Only a dataset already in the Trash can be dropped for good."""
    _drop_for_good(db, _get_trashed_or_404(db, dataset_id))
    db.commit()
    return Response(status_code=204)


def _drop_for_good(db: Session, dataset: models.Dataset) -> None:
    """Deletes this one dataset and everything it owns -- its mapping,
    rules, transforms, runs (and their staged/rejected/validation rows),
    loaded rows, and its typed table (CASCADE: views built on that table
    go too) -- leaving every other dataset untouched."""
    dataset_id = dataset.id
    mapping = dataset.mapping
    if mapping is not None:
        db.execute(sa_text(f'DROP TABLE IF EXISTS "{mapping.target_table}" CASCADE'))

    run_ids = [r.id for r in db.query(models.Run.id).filter_by(dataset_id=dataset_id).all()]
    if run_ids:
        for model in (models.ValidationIssue, models.ValidationResult, models.StagingRow, models.RejectedRow):
            db.query(model).filter(model.run_id.in_(run_ids)).delete(synchronize_session=False)

    db.query(models.LoadedRow).filter_by(dataset_id=dataset_id).delete()
    db.query(models.Run).filter_by(dataset_id=dataset_id).delete()
    db.query(models.Transform).filter_by(dataset_id=dataset_id).delete()
    db.query(models.ValidationRule).filter_by(dataset_id=dataset_id).delete()
    if mapping is not None:
        db.delete(mapping)
    db.delete(dataset)
    audit.log(db, "dataset.dropped", "dataset", dataset_id, reason=f"name={dataset.name}")


def _capped(generator, limit: int) -> list[dict]:
    """Pulls at most `limit` rows and closes the generator promptly, so a
    streaming reader (e.g. XML) stops parsing the source file as soon as
    enough rows exist for a preview instead of reading it to the end."""
    rows: list[dict] = []
    try:
        for i, row in enumerate(generator):
            if i >= limit:
                break
            rows.append(row)
    finally:
        generator.close()
    return rows


@router.get("/{dataset_id}/preview", response_model=list[dict])
def preview_dataset(
    dataset_id: str, limit: int = Query(50, ge=1, le=_PREVIEW_MAX), db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)
):
    """A sample of the dataset exactly as parsed from its source file, with
    no rules or transforms applied -- read fresh each call, not backed by
    a stored table (ARCHITECTURE.md §20.5 cuts the full record review
    grid; this is its "show me what I actually uploaded" seed, not that)."""
    dataset = get_dataset_or_404(db, dataset_id, current_user)
    mapping = dataset.mapping
    if mapping is None:
        raise HTTPException(409, "Dataset has no mapping")
    try:
        if mapping.source_format == "derived":
            return derived.execute_rows(db, mapping.entity_spec_json, limit=limit)
        generator = read_rows(Path(mapping.source_path), mapping.source_format, mapping.entity_spec_json)
        return _capped(generator, limit)
    except Exception as exc:  # noqa: BLE001 - surfaced as a readable preview error
        raise HTTPException(422, f"Could not preview this dataset: {exc}") from exc


@router.get("/{dataset_id}/loaded", response_model=list[dict])
def preview_loaded(
    dataset_id: str, limit: int = Query(50, ge=1, le=_PREVIEW_MAX), db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)
):
    """A sample of the dataset's most recently loaded rows -- the output of
    the pipeline (rules + transforms applied), not the raw input.
    loaded_rows accumulates across every successful run, so this is scoped
    to latest_run_id specifically -- without that, rows from older runs
    (their own row_ordinal sequences, possibly a different output schema)
    would mix in."""
    dataset = get_dataset_or_404(db, dataset_id, current_user)
    if not dataset.latest_run_id:
        return []
    rows = (
        db.query(models.LoadedRow)
        .filter_by(dataset_id=dataset_id, run_id=dataset.latest_run_id)
        .order_by(models.LoadedRow.row_ordinal)
        .limit(limit)
        .all()
    )
    return [r.data_json for r in rows]
