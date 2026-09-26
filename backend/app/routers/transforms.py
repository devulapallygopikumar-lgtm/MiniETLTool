from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from .. import audit, models, schemas
from ..database import get_db
from ..deps import require_permission
from .datasets import get_dataset_or_404

router = APIRouter(
    prefix="/api/v1/datasets/{dataset_id}/transforms",
    tags=["transforms"],
    dependencies=[Depends(require_permission("product:read"))],
)
_manage = [Depends(require_permission("format_rule:manage"))]


def to_out(t: models.Transform) -> schemas.TransformOut:
    return schemas.TransformOut(
        id=t.id,
        dataset_id=t.dataset_id,
        column=t.column,
        op=t.op,
        args=t.args_json,
    )


def get_transform_or_404(db: Session, dataset_id: str, transform_id: str) -> models.Transform:
    transform = db.get(models.Transform, transform_id)
    if transform is None or transform.dataset_id != dataset_id:
        raise HTTPException(404, "Transform not found")
    return transform


@router.get("", response_model=list[schemas.TransformOut])
def list_transforms(dataset_id: str, db: Session = Depends(get_db)):
    get_dataset_or_404(db, dataset_id)
    rows = (
        db.query(models.Transform)
        .filter_by(dataset_id=dataset_id)
        .order_by(models.Transform.created_at)
        .all()
    )
    return [to_out(t) for t in rows]


@router.post("", response_model=schemas.TransformOut, status_code=201, dependencies=_manage)
def create_transform(dataset_id: str, body: schemas.NewTransform, db: Session = Depends(get_db)):
    get_dataset_or_404(db, dataset_id)
    transform = models.Transform(
        dataset_id=dataset_id,
        column=body.column,
        op=body.op,
        args_json=body.args,
    )
    db.add(transform)
    db.flush()
    audit.log(db, "transform.created", "transform", transform.id)
    db.commit()
    db.refresh(transform)
    return to_out(transform)


@router.patch("/{transform_id}", response_model=schemas.TransformOut, dependencies=_manage)
def update_transform(
    dataset_id: str, transform_id: str, body: schemas.TransformPatch, db: Session = Depends(get_db)
):
    get_dataset_or_404(db, dataset_id)
    transform = get_transform_or_404(db, dataset_id, transform_id)
    patch = body.model_dump(exclude_unset=True)
    for key, value in patch.items():
        if key == "args":
            transform.args_json = value
        else:
            setattr(transform, key, value)
    audit.log(db, "transform.updated", "transform", transform.id)
    db.commit()
    db.refresh(transform)
    return to_out(transform)


@router.delete("/{transform_id}", status_code=204, dependencies=_manage)
def delete_transform(dataset_id: str, transform_id: str, db: Session = Depends(get_db)):
    get_dataset_or_404(db, dataset_id)
    transform = get_transform_or_404(db, dataset_id, transform_id)
    db.delete(transform)
    audit.log(db, "transform.deleted", "transform", transform_id)
    db.commit()
    return Response(status_code=204)
