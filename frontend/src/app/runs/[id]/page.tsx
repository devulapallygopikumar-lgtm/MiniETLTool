"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  ApiError,
  getRun,
  getRunRejectsUrl,
  getRunValidation,
  getRunValidationRows,
} from "@/app/lib/api";
import { GateBadge } from "@/app/components/GateBadge";
import { StateBadge } from "@/app/components/StateBadge";
import type { Run, RunValidation, ValidationIssueRow } from "@/app/lib/types";

const TERMINAL_STATES = new Set([
  "succeeded",
  "failed",
  "validation_failed",
  "cancelled",
]);

export default function RunPage() {
  const { id } = useParams<{ id: string }>();

  const [run, setRun] = useState<Run | null>(null);
  const [validation, setValidation] = useState<RunValidation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedRule, setSelectedRule] = useState<string | null>(null);
  const [rows, setRows] = useState<ValidationIssueRow[] | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const r = await getRun(id);
        if (cancelled) return;
        setRun(r);
        setError(null);
        try {
          setValidation(await getRunValidation(id));
        } catch {
          // validation results may not exist yet (run still queued)
        }
        if (!TERMINAL_STATES.has(r.state)) {
          timer = setTimeout(poll, 2000);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Failed to load run."
          );
          timer = setTimeout(poll, 4000);
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    if (!selectedRule) return;
    getRunValidationRows(id, selectedRule)
      .then(setRows)
      .catch((err: unknown) =>
        setRowsError(
          err instanceof ApiError ? err.message : "Failed to load sample rows."
        )
      );
  }, [id, selectedRule]);

  function selectRule(ruleId: string) {
    setRows(null);
    setRowsError(null);
    setSelectedRule(ruleId);
  }

  function closeSample() {
    setSelectedRule(null);
    setRows(null);
    setRowsError(null);
  }

  if (error && !run) {
    return (
      <div className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
        {error}
      </div>
    );
  }

  if (!run) {
    return <p className="text-sm text-foreground-muted">Loading run…</p>;
  }

  const failingRules =
    validation?.results.filter((r) => r.violations > 0) ?? [];
  const live = !TERMINAL_STATES.has(run.state);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            Run <span className="font-mono text-base">{run.id}</span>
          </h1>
          <Link
            href={`/datasets/${run.dataset_id}`}
            className="text-sm text-primary hover:text-primary-dark"
          >
            {run.dataset_name}
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <StateBadge state={run.state} />
          <GateBadge state={run.gate_state} />
          {live && (
            <span className="text-xs text-foreground-muted">
              polling every 2s…
            </span>
          )}
        </div>
      </div>

      {run.error && (
        <div className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {run.error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Rows read" value={run.rows_read} />
        <Stat label="Rows written" value={run.rows_written} />
        <Stat label="Rows rejected" value={run.rows_rejected} tone="danger" />
        <Stat
          label="Duration"
          value={
            run.started_at
              ? formatDuration(run.started_at, run.finished_at)
              : "—"
          }
          isText
        />
      </div>

      {validation && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold">
            Per-rule results{" "}
            <span className="font-normal text-foreground-muted">
              (blocking first)
            </span>
          </h2>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="py-2 font-medium">Rule</th>
                <th className="py-2 font-medium">Scope</th>
                <th className="py-2 font-medium">Enforcement</th>
                <th className="py-2 font-medium">Violations</th>
                <th className="py-2 font-medium">Pass rate</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {[...validation.results]
                .sort((a, b) => {
                  const aBlock = a.enforcement === "mandatory" && a.violations > 0;
                  const bBlock = b.enforcement === "mandatory" && b.violations > 0;
                  if (aBlock !== bBlock) return aBlock ? -1 : 1;
                  return b.violations - a.violations;
                })
                .map((r) => (
                  <tr key={r.rule_id} className="border-b border-border last:border-0">
                    <td className="py-2">
                      {r.rule}
                      {r.column && (
                        <span className="text-foreground-muted"> · {r.column}</span>
                      )}
                    </td>
                    <td className="py-2 text-foreground-muted">{r.scope}</td>
                    <td className="py-2 text-foreground-muted capitalize">
                      {r.enforcement.replace("_", " ")}
                    </td>
                    <td
                      className={`py-2 font-semibold ${
                        r.violations > 0
                          ? r.enforcement === "mandatory"
                            ? "text-danger"
                            : "text-warning"
                          : "text-success"
                      }`}
                    >
                      {r.violations}
                    </td>
                    <td className="py-2 text-foreground-muted">
                      {(r.pass_rate * 100).toFixed(1)}%
                    </td>
                    <td className="py-2">
                      {r.violations > 0 && (
                        <button
                          type="button"
                          onClick={() => selectRule(r.rule_id)}
                          className="text-xs font-semibold text-primary hover:text-primary-dark"
                        >
                          View sample
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              {failingRules.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-foreground-muted">
                    No violations.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedRule && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Failing rows — {selectedRule}
            </h2>
            <button
              type="button"
              onClick={closeSample}
              className="text-xs text-foreground-muted hover:text-foreground"
            >
              Close
            </button>
          </div>
          {rowsError && (
            <p className="text-xs text-danger">{rowsError}</p>
          )}
          {!rowsError && rows === null && (
            <p className="text-xs text-foreground-muted">Loading sample…</p>
          )}
          {rows && rows.length === 0 && (
            <p className="text-xs text-foreground-muted">No sample rows returned.</p>
          )}
          {rows && rows.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-foreground-muted">
                <tr>
                  <th className="py-1.5 font-medium">Row</th>
                  <th className="py-1.5 font-medium">Column</th>
                  <th className="py-1.5 font-medium">Value</th>
                  <th className="py-1.5 font-medium">Message</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="py-1.5 font-mono text-xs">{row.row_ordinal}</td>
                    <td className="py-1.5 text-foreground-muted">
                      {row.column_name ?? "—"}
                    </td>
                    <td className="py-1.5">
                      <code className="rounded bg-danger-soft px-1.5 py-0.5 text-xs text-danger">
                        {row.offending_value ?? "null"}
                      </code>
                    </td>
                    <td className="py-1.5 text-foreground-muted">{row.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {run.rows_rejected > 0 && (
        <a
          href={getRunRejectsUrl(id)}
          className="w-fit rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-soft"
        >
          Download {run.rows_rejected} rejected row
          {run.rows_rejected === 1 ? "" : "s"} (CSV)
        </a>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  isText,
}: {
  label: string;
  value: number | string;
  tone?: "danger";
  isText?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="text-xs text-foreground-muted">{label}</div>
      <div
        className={`text-lg font-semibold ${
          tone === "danger" && Number(value) > 0 ? "text-danger" : ""
        }`}
      >
        {isText ? value : (value as number).toLocaleString()}
      </div>
    </div>
  );
}

function formatDuration(start: string, end: string | null): string {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}
