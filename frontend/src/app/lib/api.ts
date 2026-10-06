// Centralized API access (ARCHITECTURE.md §15: "API access centralized in
// src/app/lib/api.ts with the base URL from NEXT_PUBLIC_API_BASE").
// No page or component should call fetch() directly against the backend.

import type {
  AuditEvent,
  AuthMe,
  Connection,
  LoanContact,
  LoanLedgerMatch,
  LoanMaster,
  LoanTallyResult,
  TallyStatus,
  LoanTallyReport,
  TallyReportStatus,
  NewTargetMapping,
  TargetColumn,
  TargetMapping,
  TargetTable,
  ConnectionTestResult,
  Dataset,
  NewConnection,
  NewDerivedDataset,
  NewClient,
  NewUser,
  ResetSummary,
  Run,
  RunValidation,
  Transform,
  User,
  UserPatch,
  Client,
  Domain,
  ValidationIssueRow,
  ValidationRule,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

// The access token lives in memory only (never localStorage -- a
// JS-readable token is exactly what an XSS payload goes looking for) and
// is attached to every request from here, centrally. The refresh token
// travels as an httpOnly cookie the browser sends on its own
// (credentials: "include"); this module never sees its value.
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

async function rawRequest(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(init?.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(
      0,
      `Could not reach the API at ${API_BASE}. Is the backend running?`
    );
  }
}

// Concurrent 401s should trigger one refresh, not a stampede -- every
// caller in flight shares the same in-progress attempt.
let refreshing: Promise<{ access_token: string; user: User } | null> | null = null;

export function refreshSession(): Promise<{ access_token: string; user: User } | null> {
  if (!refreshing) {
    refreshing = rawRequest("/api/v1/auth/refresh", { method: "POST" })
      .then(async (res) => {
        if (!res.ok) return null;
        const body = await res.json();
        setAccessToken(body.access_token);
        return body;
      })
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const res = await rawRequest(path, init);

  const skipAutoRefresh = path === "/api/v1/auth/login" || path === "/api/v1/auth/refresh";
  if (res.status === 401 && !retried && !skipAutoRefresh) {
    const refreshed = await refreshSession();
    if (refreshed) return request<T>(path, init, true);
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.detail ?? body.message ?? message;
    } catch {
      // body wasn't JSON; fall back to statusText
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---- Datasets ----

export function listDatasets(): Promise<Dataset[]> {
  return request("/api/v1/datasets");
}

export function getDataset(id: string): Promise<Dataset> {
  return request(`/api/v1/datasets/${id}`);
}

export function deleteDataset(id: string): Promise<void> {
  return request(`/api/v1/datasets/${id}`, { method: "DELETE" });
}

export function previewDataset(
  id: string,
  limit = 50
): Promise<Record<string, unknown>[]> {
  return request(`/api/v1/datasets/${id}/preview?limit=${limit}`);
}

export function previewLoaded(
  id: string,
  limit = 50
): Promise<Record<string, unknown>[]> {
  return request(`/api/v1/datasets/${id}/loaded?limit=${limit}`);
}

export interface UploadResult {
  datasets: Dataset[];
}

/** Excel-only upload rules; the backend ignores them for CSV/XML. */
export interface ExcelUploadOptions {
  hasHeader: boolean; // first row holds the column names
  startRow: number | null; // 1-based row where the header/data begins; null = auto-detect
  trim: boolean; // strip whitespace from cells
}

export function uploadFile(
  file: File,
  clientId: string,
  excel?: ExcelUploadOptions
): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("client_id", clientId);
  if (excel) {
    form.append("excel_has_header", String(excel.hasHeader));
    if (excel.startRow !== null) form.append("excel_start_row", String(excel.startRow));
    form.append("excel_trim", String(excel.trim));
  }
  return request("/api/v1/uploads", { method: "POST", body: form });
}

// ---- Rules ----

export function listRules(datasetId: string): Promise<ValidationRule[]> {
  return request(`/api/v1/datasets/${datasetId}/rules`);
}

export type NewRule = Omit<ValidationRule, "id" | "dataset_id">;

export function createRule(
  datasetId: string,
  rule: NewRule
): Promise<ValidationRule> {
  return request(`/api/v1/datasets/${datasetId}/rules`, {
    method: "POST",
    body: JSON.stringify(rule),
  });
}

export function updateRule(
  datasetId: string,
  ruleId: string,
  patch: Partial<NewRule>
): Promise<ValidationRule> {
  return request(`/api/v1/datasets/${datasetId}/rules/${ruleId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteRule(datasetId: string, ruleId: string): Promise<void> {
  return request(`/api/v1/datasets/${datasetId}/rules/${ruleId}`, {
    method: "DELETE",
  });
}

// ---- Transforms ----

export function listTransforms(datasetId: string): Promise<Transform[]> {
  return request(`/api/v1/datasets/${datasetId}/transforms`);
}

export type NewTransform = Omit<Transform, "id" | "dataset_id">;

export function createTransform(
  datasetId: string,
  transform: NewTransform
): Promise<Transform> {
  return request(`/api/v1/datasets/${datasetId}/transforms`, {
    method: "POST",
    body: JSON.stringify(transform),
  });
}

export function deleteTransform(datasetId: string, transformId: string): Promise<void> {
  return request(`/api/v1/datasets/${datasetId}/transforms/${transformId}`, {
    method: "DELETE",
  });
}

// ---- Runs ----

export function runDataset(datasetId: string): Promise<Run> {
  return request(`/api/v1/datasets/${datasetId}/run`, { method: "POST" });
}

export function listRuns(datasetId: string): Promise<Run[]> {
  return request(`/api/v1/datasets/${datasetId}/runs`);
}

export function getRun(runId: string): Promise<Run> {
  return request(`/api/v1/runs/${runId}`);
}

export function getRunValidation(runId: string): Promise<RunValidation> {
  return request(`/api/v1/runs/${runId}/validation`);
}

export function getRunValidationRows(
  runId: string,
  ruleId: string
): Promise<ValidationIssueRow[]> {
  return request(
    `/api/v1/runs/${runId}/validation/${ruleId}/rows`
  );
}

export function getRunRejectsUrl(runId: string): string {
  return `${API_BASE}/api/v1/runs/${runId}/rejects`;
}

// ---- Process (derived datasets) ----

export function createDerivedDataset(
  body: NewDerivedDataset
): Promise<Dataset> {
  return request("/api/v1/process", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ---- Connections (Target Dataset) ----

export function listConnections(): Promise<Connection[]> {
  return request("/api/v1/connections");
}

export function createConnection(body: NewConnection): Promise<Connection> {
  return request("/api/v1/connections", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateConnection(
  connectionId: string,
  patch: Partial<NewConnection>
): Promise<Connection> {
  return request(`/api/v1/connections/${connectionId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteConnection(connectionId: string): Promise<void> {
  return request(`/api/v1/connections/${connectionId}`, { method: "DELETE" });
}

export function testConnection(
  connectionId: string
): Promise<ConnectionTestResult> {
  return request(`/api/v1/connections/${connectionId}/test`, {
    method: "POST",
  });
}

// ---- Admin ----

export function resetEverything(): Promise<ResetSummary> {
  return request("/api/v1/admin/reset", { method: "POST" });
}

// ---- Audit ----

export function listAuditEvents(): Promise<AuditEvent[]> {
  return request("/api/v1/audit-events");
}

// ---- Auth ----

export async function login(email: string, password: string): Promise<User> {
  const body = await request<{ access_token: string; user: User }>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setAccessToken(body.access_token);
  return body.user;
}

export async function logout(): Promise<void> {
  try {
    await request("/api/v1/auth/logout", { method: "POST" });
  } finally {
    setAccessToken(null);
  }
}

export function me(): Promise<AuthMe> {
  return request("/api/v1/auth/me");
}

// ---- Users (Admin only) ----

export function listUsers(): Promise<User[]> {
  return request("/api/v1/users");
}

export function createUser(body: NewUser): Promise<User> {
  return request("/api/v1/users", { method: "POST", body: JSON.stringify(body) });
}

export function updateUser(userId: string, patch: UserPatch): Promise<User> {
  return request(`/api/v1/users/${userId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteUser(userId: string): Promise<void> {
  return request(`/api/v1/users/${userId}`, { method: "DELETE" });
}

// ---- Runs: approval ----

export function approveRun(runId: string): Promise<Run> {
  return request(`/api/v1/runs/${runId}/approve`, { method: "POST" });
}

// ---- Domains & clients ----

export function listDomains(): Promise<Domain[]> {
  return request("/api/v1/domains");
}

export function createDomain(name: string): Promise<Domain> {
  return request("/api/v1/domains", { method: "POST", body: JSON.stringify({ name }) });
}

export function deleteDomain(id: string): Promise<void> {
  return request(`/api/v1/domains/${id}`, { method: "DELETE" });
}

export function listClients(): Promise<Client[]> {
  return request("/api/v1/clients");
}

export function createClient(body: NewClient): Promise<Client> {
  return request("/api/v1/clients", { method: "POST", body: JSON.stringify(body) });
}

export function deleteClient(id: string): Promise<void> {
  return request(`/api/v1/clients/${id}`, { method: "DELETE" });
}

// ---- Trash / drop ----

export function listTrash(): Promise<Dataset[]> {
  return request("/api/v1/datasets/trash");
}

export function restoreDataset(id: string): Promise<Dataset> {
  return request(`/api/v1/datasets/${id}/restore`, { method: "POST" });
}

export function dropDatasetPermanently(id: string): Promise<void> {
  return request(`/api/v1/datasets/${id}/permanent`, { method: "DELETE" });
}

export function emptyTrash(): Promise<{ dropped: number }> {
  return request("/api/v1/datasets/trash/empty", { method: "POST" });
}

// ---- Field mapping ----

export function listTargetTables(connectionId: string): Promise<TargetTable[]> {
  return request(`/api/v1/connections/${connectionId}/tables`);
}

export function listTargetColumns(connectionId: string, schema: string, table: string): Promise<TargetColumn[]> {
  const q = new URLSearchParams({ schema_name: schema, table });
  return request(`/api/v1/connections/${connectionId}/columns?${q}`);
}

export function listTargetMappings(): Promise<TargetMapping[]> {
  return request("/api/v1/target-mappings");
}

export function saveTargetMapping(body: NewTargetMapping): Promise<TargetMapping> {
  return request("/api/v1/target-mappings", { method: "PUT", body: JSON.stringify(body) });
}

export function deleteTargetMapping(id: string): Promise<void> {
  return request(`/api/v1/target-mappings/${id}`, { method: "DELETE" });
}

// ---- Loan details ----

export function listLoanContacts(): Promise<LoanContact[]> {
  return request("/api/v1/loan-details/contacts");
}

export function getLoanMaster(name: string, fileNo: string): Promise<LoanMaster> {
  const q = new URLSearchParams({ name, file_no: fileNo });
  return request(`/api/v1/loan-details/master?${q}`);
}

export function getLoanLedger(name: string, fileNo: string): Promise<LoanLedgerMatch> {
  const q = new URLSearchParams({ name, file_no: fileNo });
  return request(`/api/v1/loan-details/ledger?${q}`);
}

// ---- Loan tally ----

export function listLoanTallies(): Promise<LoanTallyResult> {
  return request("/api/v1/loan-tally");
}

export function tallyLoan(name: string, fileNo: string): Promise<LoanTallyResult> {
  return request("/api/v1/loan-tally", {
    method: "POST",
    body: JSON.stringify({ name, file_no: fileNo }),
  });
}

export function startTallyAll(): Promise<TallyStatus> {
  return request("/api/v1/loan-tally/run-all", { method: "POST" });
}

export function getTallyStatus(): Promise<TallyStatus> {
  return request("/api/v1/loan-tally/status");
}

export function getTallyReport(status: TallyReportStatus): Promise<LoanTallyReport> {
  return request(`/api/v1/loan-tally/report?${new URLSearchParams({ status })}`);
}
