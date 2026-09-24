"use client";

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
import { Alert, Breadcrumb, Button, Card, CardHeader, IconChevronRight, IconX } from "@/app/components/ui";
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
  const [resultsCollapsed, setResultsCollapsed] = useState(false);

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
    return <Alert>{error}</Alert>;
  }

  if (!run) {
    return <p className="text-sm text-foreground-muted">Loading run…</p>;
  }

  const failingRules =
    validation?.results.filter((r) => r.violations > 0) ?? [];
  const live = !TERMINAL_STATES.has(run.state);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Breadcrumb
            items={[
              { label: "Datasets", href: "/" },
              { label: run.dataset_name, href: `/datasets/${run.dataset_id}` },
              { label: "Run" },
            ]}
          />
          <h1 className="text-xl font-semibold">
            Run <span className="font-mono text-base">{run.id}</span>
          </h1>
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

      {run.error && <Alert>{run.error}</Alert>}

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
        <Card>
          <CardHeader
            title={
              <>
                Per-rule results{" "}
                <span className="font-normal text-foreground-muted">
                  (blocking first)
                </span>
              </>
            }
            actions={
              <Button variant="white" size="sm" iconOnly onClick={() => setResultsCollapsed((c) => !c)}>
                <IconChevronRight className={`h-3.5 w-3.5 transition-transform ${resultsCollapsed ? "" : "rotate-90"}`} />
              </Button>
            }
          />
          {!resultsCollapsed && (
            <div className="p-4 pt-0">
              <div className="max-w-full overflow-auto rounded-md border-2 border-border" style={{ maxHeight: "50vh" }}>
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 border-b-2 border-border bg-surface-soft text-xs uppercase tracking-wide text-foreground-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">Rule</th>
                      <th className="px-3 py-2 font-medium">Scope</th>
                      <th className="px-3 py-2 font-medium">Enforcement</th>
                      <th className="px-3 py-2 font-medium">Violations</th>
                      <th className="px-3 py-2 font-medium">Pass rate</th>
                      <th className="px-3 py-2 font-medium"></th>
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
                          <td className="px-3 py-2">
                            {r.rule}
                            {r.column && (
                              <span className="text-foreground-muted"> · {r.column}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-foreground-muted">{r.scope}</td>
                          <td className="px-3 py-2 text-foreground-muted capitalize">
                            {r.enforcement.replace("_", " ")}
                          </td>
                          <td
                            className={`px-3 py-2 font-semibold ${
                              r.violations > 0
                                ? r.enforcement === "mandatory"
                                  ? "text-danger"
                                  : "text-warning"
                                : "text-success"
                            }`}
                          >
                            {r.violations}
                          </td>
                          <td className="px-3 py-2 text-foreground-muted">
                            {(r.pass_rate * 100).toFixed(1)}%
                          </td>
                          <td className="px-3 py-2">
                            {r.violations > 0 && (
                              <Button
                                variant="white"
                                size="sm"
                                className="border-0 !px-0 !py-0 text-primary hover:bg-transparent hover:text-primary-dark"
                                onClick={() => selectRule(r.rule_id)}
                              >
                                View sample
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    {failingRules.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-4 text-center text-foreground-muted">
                          No violations.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}

      {selectedRule && (
        <Card>
          <CardHeader
            title={`Failing rows — ${selectedRule}`}
            actions={
              <Button variant="outline" size="sm" iconOnly onClick={closeSample} title="Close">
                <IconX />
              </Button>
            }
          />
          <div className="p-4 pt-0">
            {rowsError && <p className="text-xs text-danger">{rowsError}</p>}
            {!rowsError && rows === null && (
              <p className="text-xs text-foreground-muted">Loading sample…</p>
            )}
            {rows && rows.length === 0 && (
              <p className="text-xs text-foreground-muted">No sample rows returned.</p>
            )}
            {rows && rows.length > 0 && (
              <div className="max-w-full overflow-auto rounded-md border-2 border-border" style={{ maxHeight: "50vh" }}>
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 border-b-2 border-border bg-surface-soft text-xs uppercase tracking-wide text-foreground-muted">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">Row</th>
                      <th className="px-3 py-1.5 font-medium">Column</th>
                      <th className="px-3 py-1.5 font-medium">Value</th>
                      <th className="px-3 py-1.5 font-medium">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="px-3 py-1.5 font-mono text-xs">{row.row_ordinal}</td>
                        <td className="px-3 py-1.5 text-foreground-muted">
                          {row.column_name ?? "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          <code className="rounded bg-danger-soft px-1.5 py-0.5 text-xs text-danger">
                            {row.offending_value ?? "null"}
                          </code>
                        </td>
                        <td className="px-3 py-1.5 text-foreground-muted">{row.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      )}

      {run.rows_rejected > 0 && (
        <Button href={getRunRejectsUrl(id)} variant="white" className="w-fit">
          Download {run.rows_rejected} rejected row
          {run.rows_rejected === 1 ? "" : "s"} (CSV)
        </Button>
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
