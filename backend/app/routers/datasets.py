from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/v1/datasets", tags=["datasets"])


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
