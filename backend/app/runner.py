"""Discovery (fan-out) and run orchestration (ARCHITECTURE.md §20.3).

Discovery: one Dataset + one Mapping per discovered entity (§4.5).
A run: parse -> stage -> validate -> gate -> transform -> load, always
staging (§20.3 hour 7's simplification), running as a FastAPI background
task (§20.3 hour 8).
"""

from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from . import audit, derived, models, target_tables
from .config import settings
from .database import SessionLocal
from .readers.base import discover_entities, read_rows
from .readers.xml_tally_masters_reader import looks_like_tally_masters
from .readers.xml_tally_reader import looks_like_tally
from .transforms import TransformSpec, build_lookup_index, run_transforms
from .validation import RuleSpec, run_validation


def _now() -> datetime:
    return datetime.now(timezone.utc)


def discover_and_create_datasets(
    db: Session, path: Path, filename: str, format: str
) -> list[models.Dataset]:
    # A generic .xml upload gets the curated Tally reader instead of the
    # tag-frequency heuristic when it's actually a Tally export — same
    # source format slot, better output, no user action needed (see the
    # 'xml-tally'/'xml-tally-masters' readers' docstrings for why).
    if format == "xml" and looks_like_tally(path):
        format = "xml-tally"
    elif format == "xml" and looks_like_tally_masters(path):
        format = "xml-tally-masters"

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
        if mapping.source_format == "derived":
            # A processed entity (sort/group-by/join/dedupe/window/pivot):
            # no file to read, re-run the operator's SQL against the source
            # dataset(s)' typed tables instead (see app/derived.py).
            rows = derived.execute_rows(db, mapping.entity_spec_json)
        else:
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

    run.state = "transforming"
    db.commit()

    transform_rows = db.query(models.Transform).filter_by(dataset_id=dataset.id).all()
    transform_specs = [TransformSpec(t.id, t.column, t.op, t.args_json) for t in transform_rows]

    # lookup transforms need another dataset's already-loaded rows, fetched
    # once per run rather than per row.
    lookup_indexes: dict[str, dict[str, dict]] = {}
    for spec in transform_specs:
        if spec.op != "lookup":
            continue
        source_id = spec.args.get("source_dataset_id")
        match_column = spec.args.get("source_match_column") or spec.args.get("match_column")
        if not source_id or not match_column:
            continue
        source_rows = [r.data_json for r in db.query(models.LoadedRow).filter_by(dataset_id=source_id).all()]
        lookup_indexes[spec.id] = build_lookup_index(source_rows, match_column)

    rejected_ordinals = outcome.rejected_ordinals
    validation_passed = [(i, row) for i, row in enumerate(rows, start=1) if i not in rejected_ordinals]
    for i, row in enumerate(rows, start=1):
        if i in rejected_ordinals:
            # Rejects keep the original values -- diagnosing a reject means
            # seeing what was actually there, not the transformed version.
            db.add(
                models.RejectedRow(
                    run_id=run.id, row_ordinal=i, reason="advisory rule set to reject_row", data_json=row
                )
            )

    result = run_transforms(validation_passed, transform_specs, dataset.columns_json, lookup_indexes)

    for ordinal, dropped_row, reason in result.dropped:
        db.add(models.RejectedRow(run_id=run.id, row_ordinal=ordinal, reason=reason, data_json=dropped_row))

    loaded_ordinals = [ordinal for ordinal, _ in result.rows]
    loaded_rows_batch = [row for _, row in result.rows]
    for ordinal, row in result.rows:
        db.add(models.LoadedRow(dataset_id=dataset.id, run_id=run.id, row_ordinal=ordinal, data_json=row))
    written = len(result.rows)
    db.commit()

    run.state = "loading"
    dataset.state = "loading"
    db.commit()

    # The queryable target: a real, typed table generated from the run's
    # output schema (dataset's pinned schema, adjusted for any rename /
    # derive / cast / sequence / project transform), not just the
    # loaded_rows JSON dump (ARCHITECTURE.md §4.2).
    try:
        col_map = target_tables.ensure_table(db.connection(), mapping.target_table, result.columns)
        target_tables.insert_rows(db.connection(), mapping.target_table, run.id, loaded_rows_batch, loaded_ordinals, col_map)
        db.commit()
    except Exception as exc:  # noqa: BLE001 - surfaced to the user as run.error
        db.rollback()
        run.state = "failed"
        run.error = f"Failed to write the typed table: {exc}"
        run.finished_at = _now()
        dataset.state = "failed"
        audit.log(db, "run.failed", "run", run.id, outcome="denied", reason=run.error)
        db.commit()
        return

    run.rows_written = written
    run.rows_rejected = len(rejected_ordinals) + len(result.dropped)
    run.state = "succeeded"
    run.finished_at = _now()
    dataset.state = "loaded"
    dataset.row_count = written
    audit.log(db, "run.succeeded", "run", run.id)
    db.commit()
