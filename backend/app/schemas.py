"""Pydantic response/request models mirroring frontend/src/app/lib/types.ts exactly."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

SourceFormat = Literal["csv", "excel", "xml", "xml-tally", "xml-tally-masters"]
DatasetState = Literal[
    "discovered",
    "validating",
    "validation_failed",
    "validated",
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
    columns: list[SchemaColumn]
    created_at: datetime
    latest_run_id: str | None


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


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    dataset_id: str
    dataset_name: str
    state: RunState
    gate_state: GateState
    started_at: datetime | None
    finished_at: datetime | None
    rows_read: int
    rows_written: int
    rows_rejected: int
    error: str | None


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
