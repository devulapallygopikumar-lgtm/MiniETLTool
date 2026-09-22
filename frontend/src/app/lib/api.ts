// Centralized API access (ARCHITECTURE.md §15: "API access centralized in
// src/app/lib/api.ts with the base URL from NEXT_PUBLIC_API_BASE").
// No page or component should call fetch() directly against the backend.

import type {
  AuditEvent,
  Dataset,
  Run,
  RunValidation,
  Transform,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(
      0,
      `Could not reach the API at ${API_BASE}. Is the backend running?`
    );
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

export function uploadFile(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
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

// ---- Audit ----

export function listAuditEvents(): Promise<AuditEvent[]> {
  return request("/api/v1/audit-events");
}
