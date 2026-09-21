"""Initial schema: the six tables from ARCHITECTURE.md §20.3 hour 1, plus the
staging/reject/load row stores that back the always-stage run pipeline.

Revision ID: 0001
Revises:
Create Date: 2026-09-21

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "datasets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(64), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("source_filename", sa.String(512), nullable=False),
        sa.Column("format", sa.String(16), nullable=False),
        sa.Column("entity_name", sa.String(255), nullable=False),
        sa.Column("state", sa.String(32), nullable=False, server_default="discovered"),
        sa.Column("gate_state", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("row_count", sa.Integer(), nullable=True),
        sa.Column("columns_json", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("latest_run_id", sa.String(36), nullable=True),
    )

    op.create_table(
        "mappings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(64), nullable=False, index=True),
        sa.Column("dataset_id", sa.String(36), sa.ForeignKey("datasets.id"), nullable=False, unique=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("kind", sa.String(16), nullable=False, server_default="sync"),
        sa.Column("source_path", sa.String(1024), nullable=False),
        sa.Column("source_format", sa.String(16), nullable=False),
        sa.Column("entity_spec_json", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("schema_json", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("target_table", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "validation_rules",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(64), nullable=False, index=True),
        sa.Column("dataset_id", sa.String(36), sa.ForeignKey("datasets.id"), nullable=False, index=True),
        sa.Column("scope", sa.String(16), nullable=False),
        sa.Column("column", sa.String(255), nullable=True),
        sa.Column("rule", sa.String(32), nullable=False),
        sa.Column("args_json", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("enforcement", sa.String(16), nullable=False, server_default="mandatory"),
        sa.Column("on_violation", sa.String(16), nullable=False, server_default="keep"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(64), nullable=False, index=True),
        sa.Column("dataset_id", sa.String(36), sa.ForeignKey("datasets.id"), nullable=False, index=True),
        sa.Column("mapping_id", sa.String(36), sa.ForeignKey("mappings.id"), nullable=False),
        sa.Column("mapping_version", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(32), nullable=False, server_default="queued"),
        sa.Column("gate_state", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rows_read", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rows_written", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rows_rejected", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("parameters_json", postgresql.JSONB, nullable=False, server_default="{}"),
    )

    op.create_table(
        "validation_results",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("run_id", sa.String(36), sa.ForeignKey("runs.id"), nullable=False, index=True),
        sa.Column("rule_id", sa.String(36), sa.ForeignKey("validation_rules.id"), nullable=False),
        sa.Column("scope", sa.String(16), nullable=False),
        sa.Column("column", sa.String(255), nullable=True),
        sa.Column("rule", sa.String(32), nullable=False),
        sa.Column("enforcement", sa.String(16), nullable=False),
        sa.Column("violations", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rows_checked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("pass_rate", sa.Float(), nullable=False, server_default="1"),
    )

    op.create_table(
        "validation_issues",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("run_id", sa.String(36), sa.ForeignKey("runs.id"), nullable=False, index=True),
        sa.Column("rule_id", sa.String(36), sa.ForeignKey("validation_rules.id"), nullable=False, index=True),
        sa.Column("row_ordinal", sa.Integer(), nullable=False),
        sa.Column("column_name", sa.String(255), nullable=True),
        sa.Column("offending_value", sa.Text(), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
    )

    op.create_table(
        "staging_rows",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("run_id", sa.String(36), sa.ForeignKey("runs.id"), nullable=False, index=True),
        sa.Column("row_ordinal", sa.Integer(), nullable=False),
        sa.Column("data_json", postgresql.JSONB, nullable=False),
    )

    op.create_table(
        "rejected_rows",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("run_id", sa.String(36), sa.ForeignKey("runs.id"), nullable=False, index=True),
        sa.Column("row_ordinal", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("data_json", postgresql.JSONB, nullable=False),
    )

    op.create_table(
        "loaded_rows",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("dataset_id", sa.String(36), sa.ForeignKey("datasets.id"), nullable=False, index=True),
        sa.Column("run_id", sa.String(36), sa.ForeignKey("runs.id"), nullable=False, index=True),
        sa.Column("row_ordinal", sa.Integer(), nullable=False),
        sa.Column("data_json", postgresql.JSONB, nullable=False),
        sa.Column("loaded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(64), nullable=False, index=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("actor", sa.String(128), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("resource_type", sa.String(64), nullable=False),
        sa.Column("resource_id", sa.String(36), nullable=False),
        sa.Column("outcome", sa.String(16), nullable=False, server_default="success"),
        sa.Column("reason", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("audit_events")
    op.drop_table("loaded_rows")
    op.drop_table("rejected_rows")
    op.drop_table("staging_rows")
    op.drop_table("validation_issues")
    op.drop_table("validation_results")
    op.drop_table("runs")
    op.drop_table("validation_rules")
    op.drop_table("mappings")
    op.drop_table("datasets")
