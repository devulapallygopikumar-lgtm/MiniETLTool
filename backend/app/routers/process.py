"""'Process the data into a new entity' (ARCHITECTURE.md §5.3's blocking
operators): sort, group-by/aggregate, join, distinct/dedupe, window
functions, pivot/unpivot. See app/derived.py for why this is a separate
Dataset+Mapping pair rather than a Transform on the source dataset."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import audit, derived, models, schemas, target_tables
from ..database import get_db
from ..deps import get_current_user, require_permission
from ..readers.inference import infer_schema
from .datasets import to_out

router = APIRouter(
    prefix="/api/v1/process",
    tags=["process"],
    dependencies=[Depends(require_permission("product:manage"))],
)

# Bounds how many rows build time reads into Python for schema inference.
# Not a file upload's discovery-step sample (a small slice taken purely
# for speed before reading a huge file): this is generous specifically to
# keep the "infer from real data, not 50 rows that happen to look
# all-integer" guarantee for any dataset of realistic size, while still
# capping the worst case -- a join whose key isn't unique on the right
# side can fan out multiplicatively, and reading every one of those rows
# into Python is what hung a build for 90+ seconds in testing, over just
# a ~40k-row source. The true row count still comes from a real
# count(*), never from this sample's length -- see derived.count_rows.
_SCHEMA_SAMPLE_LIMIT = 5000


@router.post("", response_model=schemas.DatasetOut)
def create_derived_dataset(
    body: schemas.NewDerivedDataset,
    current_user: models.User = Depends(get_current_user),  # router-level dependency already checked the permission
    db: Session = Depends(get_db),
):
    spec = {"op": body.op, "source_dataset_id": body.source_dataset_id, "args": body.args}

    try:
        _, columns = derived.build_sql(db, spec)
        sample_rows = derived.execute_rows(db, spec, limit=_SCHEMA_SAMPLE_LIMIT)
        total_rows = derived.count_rows(db, spec)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    columns_json = infer_schema(sample_rows, columns)

    existing_tables = {t for (t,) in db.query(models.Mapping.target_table).all()}
    table_name = target_tables.unique_table_name(
        target_tables.slugify_identifier(body.name), existing_tables
    )

    # A human-readable name, not the source's raw id -- this is what
    # shows up as "Source" wherever a dataset is listed (Home, Final
    # Datasets, this dataset's own page).
    source = db.get(models.Dataset, body.source_dataset_id)
    source_label = source.name if source else body.source_dataset_id

    dataset = models.Dataset(
        name=body.name,
        source_filename=f"{body.op} of {source_label}",
        format="derived",
        entity_name=body.name,
        state="discovered",
        gate_state="pending",
        row_count=None,
        preview_row_count=total_rows,
        columns_json=columns_json,
        created_by=current_user.id,
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
