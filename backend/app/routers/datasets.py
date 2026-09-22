from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..readers.base import read_rows

router = APIRouter(prefix="/api/v1/datasets", tags=["datasets"])

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
        columns=[schemas.SchemaColumn(**c) for c in d.columns_json],
        created_at=d.created_at,
        latest_run_id=d.latest_run_id,
    )


def get_dataset_or_404(db: Session, dataset_id: str) -> models.Dataset:
    dataset = db.get(models.Dataset, dataset_id)
    if dataset is None:
        raise HTTPException(404, "Dataset not found")
    return dataset


@router.get("", response_model=list[schemas.DatasetOut])
def list_datasets(db: Session = Depends(get_db)):
    rows = db.query(models.Dataset).order_by(models.Dataset.created_at.desc()).all()
    return [to_out(d) for d in rows]


@router.get("/{dataset_id}", response_model=schemas.DatasetOut)
def get_dataset(dataset_id: str, db: Session = Depends(get_db)):
    return to_out(get_dataset_or_404(db, dataset_id))


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
    dataset_id: str, limit: int = Query(50, ge=1, le=_PREVIEW_MAX), db: Session = Depends(get_db)
):
    """A sample of the dataset exactly as parsed from its source file, with
    no rules or transforms applied -- read fresh each call, not backed by
    a stored table (ARCHITECTURE.md §20.5 cuts the full record review
    grid; this is its "show me what I actually uploaded" seed, not that)."""
    dataset = get_dataset_or_404(db, dataset_id)
    mapping = dataset.mapping
    if mapping is None:
        raise HTTPException(409, "Dataset has no mapping")
    try:
        generator = read_rows(Path(mapping.source_path), mapping.source_format, mapping.entity_spec_json)
        return _capped(generator, limit)
    except Exception as exc:  # noqa: BLE001 - surfaced as a readable preview error
        raise HTTPException(422, f"Could not preview this dataset: {exc}") from exc


@router.get("/{dataset_id}/loaded", response_model=list[dict])
def preview_loaded(
    dataset_id: str, limit: int = Query(50, ge=1, le=_PREVIEW_MAX), db: Session = Depends(get_db)
):
    """A sample of the dataset's most recently loaded rows -- the output of
    the pipeline (rules + transforms applied), not the raw input.
    loaded_rows accumulates across every successful run, so this is scoped
    to latest_run_id specifically -- without that, rows from older runs
    (their own row_ordinal sequences, possibly a different output schema)
    would mix in."""
    dataset = get_dataset_or_404(db, dataset_id)
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
