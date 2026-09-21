"""Discovery (fan-out) and run orchestration (ARCHITECTURE.md §20.3).

Discovery: one Dataset + one Mapping per discovered entity (§4.5).
A run: parse -> stage -> validate -> gate -> load, always staging
(§20.3 hour 7's simplification), running as a FastAPI background task
(§20.3 hour 8).
"""

from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from . import audit, models, target_tables
from .config import settings
from .database import SessionLocal
from .readers.base import discover_entities, read_rows
from .validation import RuleSpec, run_validation


def _now() -> datetime:
    return datetime.now(timezone.utc)


def discover_and_create_datasets(
    db: Session, path: Path, filename: str, format: str
) -> list[models.Dataset]:
    entities = discover_entities(path, format)
    if not entities:
        raise ValueError(
            "No entities could be discovered in this file "
            "(no sheets/records found, or the format could not be parsed)."
        )

    datasets: list[models.Dataset] = []
    for ent in entities:
        dataset = models.Dataset(
            name=ent.entity_name,
            source_filename=filename,
            format=format,
            entity_name=ent.entity_name,
            state="discovered",
            gate_state="pending",
            row_count=None,
            columns_json=ent.columns,
        )
        db.add(dataset)
        db.flush()

        mapping = models.Mapping(
            dataset_id=dataset.id,
            version=1,
            kind="sync",
            source_path=str(path),
            source_format=format,
            entity_spec_json=ent.spec,
            schema_json=ent.columns,
            target_table=target_tables.physical_table_name(dataset.id),
        )
        db.add(mapping)

        audit.log(db, "dataset.discovered", "dataset", dataset.id)
        datasets.append(dataset)

    db.commit()
    for d in datasets:
        db.refresh(d)
    return datasets


def execute_run(run_id: str) -> None:
    db = SessionLocal()
    try:
        _execute_run(db, run_id)
    finally:
        db.close()


def _execute_run(db: Session, run_id: str) -> None:
    run = db.get(models.Run, run_id)
    if run is None:
        return
    dataset = db.get(models.Dataset, run.dataset_id)
    mapping = db.get(models.Mapping, run.mapping_id)

    run.state = "running"
    run.started_at = _now()
    dataset.state = "validating"
    db.commit()

    try:
        rows = list(read_rows(Path(mapping.source_path), mapping.source_format, mapping.entity_spec_json))
    except Exception as exc:  # noqa: BLE001 - surfaced to the user as run.error
        run.state = "failed"
        run.error = str(exc)
        run.finished_at = _now()
        dataset.state = "failed"
        audit.log(db, "run.failed", "run", run.id, outcome="denied", reason=str(exc))
        db.commit()
        return

    run.rows_read = len(rows)
    run.state = "validating"
    db.commit()

    for i, row in enumerate(rows, start=1):
        db.add(models.StagingRow(run_id=run.id, row_ordinal=i, data_json=row))
    db.commit()

    column_types = {c["name"]: c["type"] for c in dataset.columns_json}
    rule_rows = db.query(models.ValidationRule).filter_by(dataset_id=dataset.id).all()
    rule_specs = [
        RuleSpec(r.id, r.scope, r.column, r.rule, r.args_json, r.enforcement, r.on_violation)
        for r in rule_rows
    ]

    outcome = run_validation(rule_specs, rows, column_types, settings.issue_sample_cap)

    for ro in outcome.rule_outcomes:
        db.add(
            models.ValidationResult(
                run_id=run.id,
                rule_id=ro.rule_id,
                scope=ro.scope,
                column=ro.column,
                rule=ro.rule,
                enforcement=ro.enforcement,
                violations=ro.violations,
                rows_checked=ro.rows_checked,
                pass_rate=ro.pass_rate,
            )
        )
        for issue in ro.issues:
            db.add(
                models.ValidationIssue(
                    run_id=run.id,
                    rule_id=ro.rule_id,
                    row_ordinal=issue.row_ordinal,
                    column_name=issue.column_name,
                    offending_value=issue.offending_value,
                    message=issue.message,
                )
            )

    run.gate_state = outcome.gate_state
    dataset.gate_state = outcome.gate_state
    db.commit()

    if outcome.gate_state == "closed":
        run.state = "validation_failed"
        run.finished_at = _now()
        dataset.state = "validation_failed"
        audit.log(db, "run.validation_failed", "run", run.id, outcome="denied", reason="mandatory rule violated")
        db.commit()
        return

    run.state = "loading"
    dataset.state = "loading"
    db.commit()

    rejected = outcome.rejected_ordinals
    written = 0
    loaded_ordinals: list[int] = []
    loaded_rows_batch: list[dict[str, str | None]] = []
    for i, row in enumerate(rows, start=1):
        if i in rejected:
            db.add(
                models.RejectedRow(
                    run_id=run.id, row_ordinal=i, reason="advisory rule set to reject_row", data_json=row
                )
            )
        else:
            db.add(models.LoadedRow(dataset_id=dataset.id, run_id=run.id, row_ordinal=i, data_json=row))
            loaded_ordinals.append(i)
            loaded_rows_batch.append(row)
            written += 1
    db.commit()

    # The queryable target: a real, typed table generated from the dataset's
    # pinned schema, not just the loaded_rows JSON dump (ARCHITECTURE.md §4.2).
    col_map = target_tables.ensure_table(db.connection(), dataset.id, dataset.columns_json)
    target_tables.insert_rows(db.connection(), dataset.id, run.id, loaded_rows_batch, loaded_ordinals, col_map)
    db.commit()

    run.rows_written = written
    run.rows_rejected = len(rejected)
    run.state = "succeeded"
    run.finished_at = _now()
    dataset.state = "loaded"
    dataset.row_count = written
    audit.log(db, "run.succeeded", "run", run.id)
    db.commit()
