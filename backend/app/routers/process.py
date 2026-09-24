"""'Process the data into a new entity' (ARCHITECTURE.md §5.3's blocking
operators): sort, group-by/aggregate, join, distinct/dedupe, window
functions, pivot/unpivot. See app/derived.py for why this is a separate
Dataset+Mapping pair rather than a Transform on the source dataset."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import audit, derived, models, schemas, target_tables
from ..database import get_db
from ..readers.inference import infer_schema
from .datasets import to_out

router = APIRouter(prefix="/api/v1/process", tags=["process"])


@router.post("", response_model=schemas.DatasetOut)
def create_derived_dataset(body: schemas.NewDerivedDataset, db: Session = Depends(get_db)):
    spec = {"op": body.op, "source_dataset_id": body.source_dataset_id, "args": body.args}

    try:
        _, columns = derived.build_sql(db, spec)
        rows = derived.execute_rows(db, spec)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    # Infer from every row, not a sample -- unlike a file upload's discovery
    # step (which samples for performance before reading a huge file), the
    # full result set is already in memory here. A 50-row sample that
    # happens to look all-integer while later rows have decimals would
    # otherwise type the column "integer", silently truncating those later
    # values to NULL when the typed table is created.
    columns_json = infer_schema(rows, columns)

    existing_tables = {t for (t,) in db.query(models.Mapping.target_table).all()}
    table_name = target_tables.unique_table_name(
        target_tables.slugify_identifier(body.name), existing_tables
    )

    dataset = models.Dataset(
        name=body.name,
        source_filename=f"{body.op} of {body.source_dataset_id}",
        format="derived",
        entity_name=body.name,
        state="discovered",
        gate_state="pending",
        row_count=None,
        preview_row_count=len(rows),
        columns_json=columns_json,
    )
    db.add(dataset)
    db.flush()

    mapping = models.Mapping(
        dataset_id=dataset.id,
        version=1,
        kind="sync",
        source_path="",
        source_format="derived",
        entity_spec_json=spec,
        schema_json=columns_json,
        target_table=table_name,
    )
    db.add(mapping)

    audit.log(db, "dataset.derived", "dataset", dataset.id, reason=f"op={body.op}")
    db.commit()
    db.refresh(dataset)
    return to_out(dataset)
