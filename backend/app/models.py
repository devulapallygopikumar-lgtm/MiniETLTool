import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base
from .config import settings


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


# JSONB on Postgres, plain JSON elsewhere (e.g. if a test ever points this at SQLite).
JsonType = JSON().with_variant(JSONB, "postgresql")


class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(64), default=settings.default_tenant_id, index=True)
    name: Mapped[str] = mapped_column(String(255))
    source_filename: Mapped[str] = mapped_column(String(512))
    format: Mapped[str] = mapped_column(String(32))  # csv | excel | xml | xml-tally | xml-tally-masters
    entity_name: Mapped[str] = mapped_column(String(255))
    state: Mapped[str] = mapped_column(String(32), default="discovered")
    gate_state: Mapped[str] = mapped_column(String(16), default="pending")
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Set once, at build time, for a derived entity -- the row count its
    # operator spec produces against its source's *current* loaded data,
    # before this entity has ever been Run itself. Purely informational;
    # see migration 0008 for why this can't just be row_count.
    preview_row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    columns_json: Mapped[list] = mapped_column(JsonType, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    latest_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # Who uploaded/created it (uploads.py or process.py). Nullable: existing
    # rows predate auth and have no user to attribute to.
    created_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)

    mapping: Mapped["Mapping"] = relationship(back_populates="dataset", uselist=False)
    rules: Mapped[list["ValidationRule"]] = relationship(back_populates="dataset")
    transforms: Mapped[list["Transform"]] = relationship(back_populates="dataset")


class Mapping(Base):
    __tablename__ = "mappings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(64), default=settings.default_tenant_id, index=True)
    dataset_id: Mapped[str] = mapped_column(String(36), ForeignKey("datasets.id"), unique=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    # One line that keeps the full authoring tier available later without a
    # migration (ARCHITECTURE.md §20.6 #7) — the slice only ever writes 'sync'.
    kind: Mapped[str] = mapped_column(String(16), default="sync")
    source_path: Mapped[str] = mapped_column(String(1024))
    source_format: Mapped[str] = mapped_column(String(32))
    entity_spec_json: Mapped[dict] = mapped_column(JsonType, default=dict)
    schema_json: Mapped[list] = mapped_column(JsonType, default=list)
    target_table: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    dataset: Mapped["Dataset"] = relationship(back_populates="mapping")


class ValidationRule(Base):
    __tablename__ = "validation_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(64), default=settings.default_tenant_id, index=True)
    dataset_id: Mapped[str] = mapped_column(String(36), ForeignKey("datasets.id"), index=True)
    scope: Mapped[str] = mapped_column(String(16))  # column | row | dataset
    column: Mapped[str | None] = mapped_column(String(255), nullable=True)
    rule: Mapped[str] = mapped_column(String(32))  # not_null | type_parse | unique | expression
    args_json: Mapped[dict] = mapped_column(JsonType, default=dict)
    # ARCHITECTURE.md §20.6 #3 / ADR 13: enforcement lives on the rule, not a
    # global strict/lax setting.
    enforcement: Mapped[str] = mapped_column(String(16), default="mandatory")  # mandatory | move_on
    on_violation: Mapped[str] = mapped_column(String(16), default="keep")  # keep | reject_row
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    dataset: Mapped["Dataset"] = relationship(back_populates="rules")


class Transform(Base):
    """The Transform stage from ARCHITECTURE.md §7.1's pipeline diagram /
    §5.3's operator catalogue. Runs on staged rows after the gate opens,
    before load; validation still sees the original values, so a not_null
    rule on a column still reports what was actually missing even if a
    transform later fills it in for the loaded copy.

    `column` is nullable because not every op targets a single column --
    filter/sort/dedupe work on the whole row set, keyed via args_json
    instead (see app/transforms.py's docstring for the full op list and
    the fixed phase order they run in)."""

    __tablename__ = "transforms"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(64), default=settings.default_tenant_id, index=True)
    dataset_id: Mapped[str] = mapped_column(String(36), ForeignKey("datasets.id"), index=True)
    column: Mapped[str | None] = mapped_column(String(255), nullable=True)
    op: Mapped[str] = mapped_column(String(32))
    args_json: Mapped[dict] = mapped_column(JsonType, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    dataset: Mapped["Dataset"] = relationship(back_populates="transforms")


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(64), default=settings.default_tenant_id, index=True)
    dataset_id: Mapped[str] = mapped_column(String(36), ForeignKey("datasets.id"), index=True)
    mapping_id: Mapped[str] = mapped_column(String(36), ForeignKey("mappings.id"))
    # Set at creation, unlike started_at (set once the background task
    # actually begins) -- the stable sort key for a dataset's run history.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # A run is reproducible against the mapping version it ran with
    # (ARCHITECTURE.md §20.6 #5).
    mapping_version: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(32), default="queued")
    gate_state: Mapped[str] = mapped_column(String(16), default="pending")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rows_read: Mapped[int] = mapped_column(Integer, default=0)
    rows_written: Mapped[int] = mapped_column(Integer, default=0)
    rows_rejected: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Shipped empty; the hook for parameters arriving later (§20.6 #6).
    parameters_json: Mapped[dict] = mapped_column(JsonType, default=dict)
    # Nullable: existing rows predate auth and have no user to attribute to.
    created_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    # Maker-checker (ARCHITECTURE.md §11.1): the approver, once the gate
    # opens and before transform/load runs -- see app/deps.py's
    # require_maker_checker, which 403s if this would equal created_by.
    approved_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ValidationResult(Base):
    __tablename__ = "validation_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id"), index=True)
    # A rule can be removed after it's already produced results on past
    # runs (§7.5's resolution loop doesn't require keeping it around) --
    # cascade so that doesn't turn into a foreign-key error.
    rule_id: Mapped[str] = mapped_column(String(36), ForeignKey("validation_rules.id", ondelete="CASCADE"))
    scope: Mapped[str] = mapped_column(String(16))
    column: Mapped[str | None] = mapped_column(String(255), nullable=True)
    rule: Mapped[str] = mapped_column(String(32))
    enforcement: Mapped[str] = mapped_column(String(16))
    violations: Mapped[int] = mapped_column(Integer, default=0)
    rows_checked: Mapped[int] = mapped_column(Integer, default=0)
    pass_rate: Mapped[float] = mapped_column(default=1.0)


class ValidationIssue(Base):
    """Capped sample tier (ARCHITECTURE.md §7.7) — at most issue_sample_cap rows per rule."""

    __tablename__ = "validation_issues"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id"), index=True)
    rule_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("validation_rules.id", ondelete="CASCADE"), index=True
    )
    row_ordinal: Mapped[int] = mapped_column(Integer)
    column_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    offending_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    message: Mapped[str] = mapped_column(Text)


class StagingRow(Base):
    """Every run stages before validating (§20.3 hour 7 simplification: always stage)."""

    __tablename__ = "staging_rows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id"), index=True)
    row_ordinal: Mapped[int] = mapped_column(Integer)
    data_json: Mapped[dict] = mapped_column(JsonType)


class RejectedRow(Base):
    __tablename__ = "rejected_rows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id"), index=True)
    row_ordinal: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(Text)
    data_json: Mapped[dict] = mapped_column(JsonType)


class LoadedRow(Base):
    """The 'target' for the two-day slice: append-only rows per dataset (§20.5 keeps append/truncate only)."""

    __tablename__ = "loaded_rows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dataset_id: Mapped[str] = mapped_column(String(36), ForeignKey("datasets.id"), index=True)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id"), index=True)
    row_ordinal: Mapped[int] = mapped_column(Integer)
    data_json: Mapped[dict] = mapped_column(JsonType)
    loaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(64), default=settings.default_tenant_id, index=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    actor: Mapped[str] = mapped_column(String(128))
    action: Mapped[str] = mapped_column(String(64))
    resource_type: Mapped[str] = mapped_column(String(64))
    resource_id: Mapped[str] = mapped_column(String(36))
    outcome: Mapped[str] = mapped_column(String(16), default="success")
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class User(Base):
    """A login (ARCHITECTURE.md §11.1). Global per tenant, not scoped to
    a sub-resource -- role is a flat, tenant-wide grant."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(64), default=settings.default_tenant_id, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32))  # admin | operations | reviewer | auditor
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class RefreshToken(Base):
    """One row per issued refresh token, hashed at rest -- never the raw
    token, so a DB read alone can't be replayed as a session. Rotation:
    each /auth/refresh call revokes this row and inserts a new one: if a
    revoked token is ever presented again (reuse -- the token was stolen
    and both the thief and the legitimate holder tried to use it), every
    token for that user is revoked, not just this one."""

    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Connection(Base):
    """A saved RDBMS connection (ARCHITECTURE.md §12.1's `connections` table,
    scoped down for this slice: a registry only, no discovery/schema/write
    path wired to it yet, and the password is stored plain -- this slice
    has no auth or secrets manager, so that matches everything else here."""

    __tablename__ = "connections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(String(64), default=settings.default_tenant_id, index=True)
    name: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(32))  # postgres | mysql | sqlserver
    host: Mapped[str] = mapped_column(String(255))
    port: Mapped[int] = mapped_column(Integer)
    database: Mapped[str] = mapped_column(String(255))
    username: Mapped[str] = mapped_column(String(255))
    password: Mapped[str] = mapped_column(String(255))
    schema_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_test_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    last_test_error: Mapped[str | None] = mapped_column(Text, nullable=True)
