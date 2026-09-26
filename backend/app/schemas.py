"""Pydantic response/request models mirroring frontend/src/app/lib/types.ts exactly."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from .permissions import Role

SourceFormat = Literal["csv", "excel", "xml", "xml-tally", "xml-tally-masters", "derived"]
DatasetState = Literal[
    "discovered",
    "validating",
    "validation_failed",
    "validated",
    "awaiting_approval",
    "approved",
    "loading",
    "loaded",
    "failed",
]
GateState = Literal["pending", "open", "closed"]
RuleScope = Literal["column", "row", "dataset"]
RuleType = Literal["not_null", "type_parse", "unique", "expression"]
Enforcement = Literal["mandatory", "move_on"]
OnViolation = Literal["keep", "reject_row"]
RunState = Literal[
    "queued",
    "running",
    "validating",
    "validation_failed",
    "awaiting_approval",
    "approved",
    "transforming",
    "loading",
    "succeeded",
    "failed",
    "cancelled",
]


class SchemaColumn(BaseModel):
    name: str
    type: str
    nullable: bool


class DatasetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    source_filename: str
    format: SourceFormat
    entity_name: str
    state: DatasetState
    gate_state: GateState
    row_count: int | None
    # Set once, at build time, for a derived entity -- see models.Dataset.
    preview_row_count: int | None = None
    columns: list[SchemaColumn]
    created_at: datetime
    latest_run_id: str | None
    created_by: str | None = None


class UploadResult(BaseModel):
    datasets: list[DatasetOut]


class ValidationRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    dataset_id: str
    scope: RuleScope
    column: str | None
    rule: RuleType
    args: dict[str, Any]
    enforcement: Enforcement
    on_violation: OnViolation


class NewRule(BaseModel):
    scope: RuleScope
    column: str | None = None
    rule: RuleType
    args: dict[str, Any] = {}
    enforcement: Enforcement = "mandatory"
    on_violation: OnViolation = "keep"


class RulePatch(BaseModel):
    scope: RuleScope | None = None
    column: str | None = None
    rule: RuleType | None = None
    args: dict[str, Any] | None = None
    enforcement: Enforcement | None = None
    on_violation: OnViolation | None = None


TransformOp = Literal[
    "filter",
    "dedupe",
    "sort",
    "rename",
    "lookup",
    "derive",
    "cast",
    "mask",
    "fill_default",
    "sequence",
    "project",
]


class TransformOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    dataset_id: str
    column: str | None
    op: TransformOp
    args: dict[str, Any]


class NewTransform(BaseModel):
    column: str | None = None
    op: TransformOp
    args: dict[str, Any] = {}


class TransformPatch(BaseModel):
    column: str | None = None
    op: TransformOp | None = None
    args: dict[str, Any] | None = None


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    dataset_id: str
    dataset_name: str
    state: RunState
    gate_state: GateState
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    rows_read: int
    rows_written: int
    rows_rejected: int
    error: str | None
    created_by: str | None = None
    approved_by: str | None = None
    approved_at: datetime | None = None


class ValidationResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    rule_id: str
    scope: RuleScope
    column: str | None
    rule: RuleType
    enforcement: Enforcement
    violations: int
    rows_checked: int
    pass_rate: float


class RunValidationOut(BaseModel):
    gate_state: GateState
    results: list[ValidationResultOut]


class ValidationIssueRowOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    row_ordinal: int
    column_name: str | None
    offending_value: str | None
    message: str


DerivedOp = Literal["sort", "dedupe", "group_by", "window", "pivot", "unpivot", "join"]


class NewDerivedDataset(BaseModel):
    name: str
    op: DerivedOp
    source_dataset_id: str
    args: dict[str, Any] = {}


class ResetSummary(BaseModel):
    datasets: int
    mappings: int
    rules: int
    transforms: int
    runs: int
    staging_rows: int
    rejected_rows: int
    validation_results: int
    validation_issues: int
    loaded_rows: int
    audit_events: int


ConnectionKind = Literal["postgres", "mysql", "sqlserver"]


class ConnectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    kind: ConnectionKind
    host: str
    port: int
    database: str
    username: str
    schema_name: str | None
    created_at: datetime
    last_tested_at: datetime | None
    last_test_ok: bool | None
    last_test_error: str | None
    # password intentionally omitted -- write-only, never echoed back


class NewConnection(BaseModel):
    name: str
    kind: ConnectionKind
    host: str
    port: int
    database: str
    username: str
    password: str
    schema_name: str | None = None


class ConnectionPatch(BaseModel):
    name: str | None = None
    kind: ConnectionKind | None = None
    host: str | None = None
    port: int | None = None
    database: str | None = None
    username: str | None = None
    password: str | None = None  # blank/omitted leaves the stored password unchanged
    schema_name: str | None = None


class ConnectionTestResult(BaseModel):
    ok: bool
    message: str


class AuditEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    occurred_at: datetime
    actor: str
    action: str
    resource_type: str
    resource_id: str
    outcome: Literal["success", "denied"]
    reason: str | None


# ---- Auth / users (ARCHITECTURE.md §11.1) ---------------------------------


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    role: Role
    is_active: bool
    created_at: datetime
    # password_hash intentionally omitted -- write-only, never echoed back


class NewUser(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str
    password: str
    role: Role


class UserPatch(BaseModel):
    """The only place a role can change -- Admin-only (routers/users.py),
    never through any endpoint a non-admin can reach. extra="forbid" so a
    body can't also smuggle an id or created_at."""

    model_config = ConfigDict(extra="forbid")

    email: str | None = None
    password: str | None = None
    role: Role | None = None
    is_active: bool | None = None


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    user: UserOut


class MeOut(BaseModel):
    user: UserOut
    permissions: list[str]
