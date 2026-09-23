// Types for the single-tenant "two-day slice" (ARCHITECTURE.md §20).
// Trimmed from the full data model (§12.1) to what the slice's API exposes:
// no tenant_id, no bundles, no schedules, no mapplets, no parameters.

export type SourceFormat =
  | "csv"
  | "excel"
  | "xml"
  | "xml-tally"
  | "xml-tally-masters"
  | "derived";

export type DatasetState =
  | "discovered"
  | "validating"
  | "validation_failed"
  | "validated"
  | "loading"
  | "loaded"
  | "failed";

export type GateState = "pending" | "open" | "closed";

export interface Dataset {
  id: string;
  name: string;
  source_filename: string;
  format: SourceFormat;
  entity_name: string; // sheet name, table name, or XML record path
  state: DatasetState;
  gate_state: GateState;
  row_count: number | null;
  columns: SchemaColumn[];
  created_at: string;
  latest_run_id: string | null;
}

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export type RuleScope = "column" | "row" | "dataset";
export type RuleType = "not_null" | "type_parse" | "unique" | "expression";
export type Enforcement = "mandatory" | "move_on";
export type OnViolation = "keep" | "reject_row";

export interface ValidationRule {
  id: string;
  dataset_id: string;
  scope: RuleScope;
  column: string | null;
  rule: RuleType;
  args: Record<string, unknown>;
  enforcement: Enforcement;
  on_violation: OnViolation;
}

export type TransformOp =
  | "filter"
  | "dedupe"
  | "sort"
  | "rename"
  | "lookup"
  | "derive"
  | "cast"
  | "mask"
  | "fill_default"
  | "sequence"
  | "project";

export interface Transform {
  id: string;
  dataset_id: string;
  column: string | null;
  op: TransformOp;
  args: Record<string, unknown>;
}

export type RunState =
  | "queued"
  | "running"
  | "validating"
  | "validation_failed"
  | "transforming"
  | "loading"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface Run {
  id: string;
  dataset_id: string;
  dataset_name: string;
  state: RunState;
  gate_state: GateState;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  rows_read: number;
  rows_written: number;
  rows_rejected: number;
  error: string | null;
}

export interface ValidationResult {
  rule_id: string;
  scope: RuleScope;
  column: string | null;
  rule: RuleType;
  enforcement: Enforcement;
  violations: number;
  rows_checked: number;
  pass_rate: number;
}

export interface RunValidation {
  gate_state: GateState;
  results: ValidationResult[];
}

export interface ValidationIssueRow {
  row_ordinal: number;
  column_name: string | null;
  offending_value: string | null;
  message: string;
}

export type DerivedOp =
  | "sort"
  | "dedupe"
  | "group_by"
  | "window"
  | "pivot"
  | "unpivot"
  | "join";

export interface NewDerivedDataset {
  name: string;
  op: DerivedOp;
  source_dataset_id: string;
  args: Record<string, unknown>;
}

export interface AuditEvent {
  id: string;
  occurred_at: string;
  actor: string;
  action: string;
  resource_type: string;
  resource_id: string;
  outcome: "success" | "denied";
  reason: string | null;
}
