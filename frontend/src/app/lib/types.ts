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
  | "awaiting_approval"
  | "approved"
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
  // Set once, at build time, for a derived entity -- the row count its
  // operator spec produces, before it has ever been Run itself. Not the
  // same as row_count (which means "actually loaded"); see backend
  // migration 0008 for why.
  preview_row_count: number | null;
  columns: SchemaColumn[];
  created_at: string;
  latest_run_id: string | null;
  created_by: string | null;
  client_id: string | null;
  client_name: string | null;
  domain_id: string | null;
  domain_name: string | null;
  deleted_at: string | null; // set = in the Trash
  latest_rows_read: number | null; // rows the latest run read, even if not loaded
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
  | "awaiting_approval"
  | "approved"
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
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  run_number: number; // 1-based within its dataset -- show this, not the id
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
  | "no_action"
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

export interface ResetSummary {
  datasets: number;
  mappings: number;
  rules: number;
  transforms: number;
  runs: number;
  staging_rows: number;
  rejected_rows: number;
  validation_results: number;
  validation_issues: number;
  loaded_rows: number;
}

export type ConnectionKind = "postgres" | "mysql" | "sqlserver";

export interface Connection {
  id: string;
  name: string;
  kind: ConnectionKind;
  host: string;
  port: number;
  database: string;
  username: string;
  schema_name: string | null;
  created_at: string;
  last_tested_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
}

export interface NewConnection {
  name: string;
  kind: ConnectionKind;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  schema_name?: string | null;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

export interface AuditEvent {
  id: string;
  occurred_at: string;
  actor: string;
  action: string;
  resource_type: string;
  resource_id: string;
  resource_label: string | null;
  outcome: "success" | "denied";
  reason: string | null;
}

// ---- Auth / users (ARCHITECTURE.md §11.1) --------------------------------

export type Role = "admin" | "operations" | "reviewer" | "auditor";

export interface User {
  id: string;
  email: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  domain_id: string | null;
  domain_name: string | null;
}

export interface NewUser {
  email: string;
  password: string;
  role: Role;
  domain_id?: string | null;
}

export interface UserPatch {
  email?: string;
  password?: string;
  role?: Role;
  is_active?: boolean;
  domain_id?: string | null;
}

export interface AuthMe {
  user: User;
  permissions: string[];
}

export interface Domain {
  id: string;
  name: string;
  created_at: string;
}

export interface Client {
  id: string;
  domain_id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  created_at: string;
}

export interface NewClient {
  name: string;
  domain_id?: string | null; // admin only; others are forced to their own domain
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
}

// ---- Field mapping to target connection tables ----

export interface TargetTable {
  schema_name: string;
  name: string;
}

export interface TargetColumn {
  name: string;
  type: string;
  nullable: boolean;
  has_default: boolean;
  required: boolean; // NOT NULL with no default
}

/** Generate a target column's value per row instead of reading a source field. */
export interface GenerateSpec {
  kind: "uuid" | "sequence";
  prefix: string; // sequence only
  start: number; // sequence only
  step: number; // sequence only
  pad: number; // sequence only: zero-pad width
}

export interface FieldMapItem {
  target: string;
  source: string | null;
  generate?: GenerateSpec | null; // mutually exclusive with `source`
}

export interface TargetMapping {
  id: string;
  dataset_id: string;
  dataset_name: string;
  connection_id: string;
  connection_name: string;
  target_schema: string;
  target_table: string;
  fields: FieldMapItem[];
  created_at: string;
  updated_at: string;
}

export interface NewTargetMapping {
  dataset_id: string;
  connection_id: string;
  target_schema: string;
  target_table: string;
  fields: FieldMapItem[];
}

// ---- Loan details ----

export interface LoanContact {
  name: string;
  file_no: string;
}

export interface LoanMaster {
  columns: string[]; // every column of tblmstcontact_live_loans, in table order
  row: Record<string, unknown>;
}

export interface LoanLedgerMatch {
  method: { key: string; label: string } | null; // null = nothing matched
  tried: { key: string; label: string }[]; // stricter methods that matched nothing
  ledgers: { name: string; rows: number }[];
  truncated: boolean;
  rows: Record<string, unknown>[];
}
