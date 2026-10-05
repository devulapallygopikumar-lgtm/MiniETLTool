"""Field mappings: which dataset field (a New Entity, typically) fills which
column of a table in a target connection. Stored only -- loading into the
target is a separate step."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from .. import audit, models, schemas
from ..database import get_db
from ..deps import can_access_dataset, get_current_user, require_permission
from .datasets import get_dataset_or_404

router = APIRouter(
    prefix="/api/v1/target-mappings",
    tags=["target-mappings"],
    dependencies=[Depends(require_permission("mapping:read"))],
)


def _out(db: Session, m: models.TargetMapping) -> schemas.TargetMappingOut:
    dataset = db.get(models.Dataset, m.dataset_id)
    conn = db.get(models.Connection, m.connection_id)
    return schemas.TargetMappingOut(
        id=m.id,
        dataset_id=m.dataset_id,
        dataset_name=dataset.name if dataset else "",
        connection_id=m.connection_id,
        connection_name=conn.name if conn else "",
        target_schema=m.target_schema,
        target_table=m.target_table,
        fields=[schemas.FieldMapItem(**f) for f in m.fields_json],
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


def _visible(db: Session, m: models.TargetMapping, user: models.User) -> bool:
    dataset = db.get(models.Dataset, m.dataset_id)
    return dataset is not None and dataset.deleted_at is None and can_access_dataset(user, dataset)


@router.get("", response_model=list[schemas.TargetMappingOut])
def list_mappings(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(models.TargetMapping).order_by(models.TargetMapping.updated_at.desc()).all()
    return [_out(db, m) for m in rows if _visible(db, m, current_user)]


@router.put(
    "", response_model=schemas.TargetMappingOut, dependencies=[Depends(require_permission("mapping:manage"))]
)
def save_mapping(
    body: schemas.NewTargetMapping,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create or replace the mapping for this dataset + target table."""
    dataset = get_dataset_or_404(db, body.dataset_id, current_user)
    if db.get(models.Connection, body.connection_id) is None:
        raise HTTPException(404, "Connection not found")

    source_fields = {c["name"] for c in dataset.columns_json}
    seen: set[str] = set()
    for f in body.fields:
        if f.target in seen:
            raise HTTPException(422, f"Target column {f.target} is mapped twice")
        seen.add(f.target)
        if f.source is not None and f.generate is not None:
            raise HTTPException(422, f"Target column {f.target} can't have both a source field and a generator")
        if f.source is not None and f.source not in source_fields:
            raise HTTPException(422, f"{dataset.name} has no field named {f.source}")

    m = (
        db.query(models.TargetMapping)
        .filter_by(
            dataset_id=dataset.id,
            connection_id=body.connection_id,
            target_schema=body.target_schema,
            target_table=body.target_table,
        )
        .first()
    )
    fields = [f.model_dump() for f in body.fields]
    if m is None:
        m = models.TargetMapping(
            dataset_id=dataset.id,
            connection_id=body.connection_id,
            target_schema=body.target_schema,
            target_table=body.target_table,
            fields_json=fields,
            created_by=current_user.id,
        )
        db.add(m)
        db.flush()
        action = "target_mapping.created"
    else:
        m.fields_json = fields
        m.updated_at = datetime.now(timezone.utc)
        action = "target_mapping.updated"
    mapped = sum(1 for f in fields if f["source"] or f["generate"])
    audit.log(db, action, "target_mapping", m.id,
              reason=f"{dataset.name} -> {body.target_schema}.{body.target_table} ({mapped} fields)")
    db.commit()
    db.refresh(m)
    return _out(db, m)


@router.delete(
    "/{mapping_id}", status_code=204, dependencies=[Depends(require_permission("mapping:delete"))]
)
def delete_mapping(
    mapping_id: str, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)
):
    m = db.get(models.TargetMapping, mapping_id)
    if m is None or not _visible(db, m, current_user):
        raise HTTPException(404, "Mapping not found")
    db.delete(m)
    audit.log(db, "target_mapping.deleted", "target_mapping", mapping_id,
              reason=f"name={m.target_schema}.{m.target_table}")
    db.commit()
    return Response(status_code=204)
