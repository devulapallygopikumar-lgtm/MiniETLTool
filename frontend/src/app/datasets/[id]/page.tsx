"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError, approveRun, getDataset, getRun, getRunValidation, previewDataset, runDataset } from "@/app/lib/api";
import { useAuth } from "@/app/lib/auth-context";
import { StateBadge } from "@/app/components/StateBadge";
import { ValidationPanel } from "@/app/components/ValidationPanel";
import { RuleEditor } from "@/app/components/RuleEditor";
import { TransformEditor } from "@/app/components/TransformEditor";
import { RunHistory } from "@/app/components/RunHistory";
import { DataGrid } from "@/app/components/DataGrid";
import Link from "next/link";
import { Alert, Breadcrumb, Button, Card, CardBody, CardHeader, IconChevronRight, IconInfo, Pagination, usePagination } from "@/app/components/ui";
import type { Dataset, Run, RunValidation } from "@/app/lib/types";

export default function DatasetPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, can } = useAuth();

  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [validation, setValidation] = useState<RunValidation | null>(null);
  const [latestRun, setLatestRun] = useState<Run | null>(null);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<Record<string, unknown>[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [schemaCollapsed, setSchemaCollapsed] = useState(false);
  const schemaPager = usePagination(dataset?.columns);

  function refresh() {
    getDataset(id)
      .then((d) => {
        setDataset(d);
        if (d.latest_run_id) {
          getRunValidation(d.latest_run_id)
            .then(setValidation)
            .catch(() => setValidation(null));
          getRun(d.latest_run_id)
            .then(setLatestRun)
            .catch(() => setLatestRun(null));
        }
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "Failed to load dataset.")
      );
  }

  useEffect(refresh, [id]);

  async function loadPreview() {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      setPreview(await previewDataset(id, 200));
    } catch (err) {
      setPreviewError(err instanceof ApiError ? err.message : "Failed to load preview.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      const run = await runDataset(id);
      router.push(`/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start run.");
      setRunning(false);
    }
  }

  async function handleApprove() {
    if (!latestRun) return;
    setApproving(true);
    setError(null);
    try {
      await approveRun(latestRun.id);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to approve.");
    } finally {
      setApproving(false);
    }
  }

  if (error && !dataset) {
    return <Alert>{error}</Alert>;
  }

  if (!dataset) {
    return <p className="text-sm text-foreground-muted">Loading dataset…</p>;
  }

  const awaitingApproval = latestRun?.state === "awaiting_approval";
  const startedByMe = !!latestRun && latestRun.created_by === user?.id;
  const canApprove = awaitingApproval && can("batch:approve") && !startedByMe;
  const rowsText =
    dataset.row_count != null
      ? `${dataset.row_count.toLocaleString()} loaded`
      : dataset.latest_rows_read != null
      ? `${dataset.latest_rows_read.toLocaleString()} read · not loaded yet`
      : "Not counted yet — run it to count";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Breadcrumb items={[{ label: "Datasets", href: "/" }, { label: dataset.name }]} />
        <h1 className="text-xl font-semibold">{dataset.name}</h1>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Dataset details" />
          <CardBody>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs leading-5">
              <dt className="font-medium uppercase tracking-wide text-[11px] text-foreground-muted">Source file</dt>
              <dd className="break-all">{dataset.source_filename}</dd>
              <dt className="font-medium uppercase tracking-wide text-[11px] text-foreground-muted">Entity</dt>
              <dd className="break-all">{dataset.entity_name}</dd>
              <dt className="font-medium uppercase tracking-wide text-[11px] text-foreground-muted">Client</dt>
              <dd>{[dataset.domain_name, dataset.client_name].filter(Boolean).join(" › ") || "—"}</dd>
              <dt className="font-medium uppercase tracking-wide text-[11px] text-foreground-muted">Rows</dt>
              <dd>{rowsText}</dd>
              <dt className="font-medium uppercase tracking-wide text-[11px] text-foreground-muted">Columns</dt>
              <dd>{dataset.columns.length}</dd>
              <dt className="font-medium uppercase tracking-wide text-[11px] text-foreground-muted">Uploaded</dt>
              <dd>{new Date(dataset.created_at).toLocaleString()}</dd>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Status & run" />
          <CardBody className="flex flex-col gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <StateBadge state={dataset.state} />
            </div>

            {awaitingApproval ? (
              <Alert variant="info">
                <span className="text-xs leading-5">
                Validation passed, so the rows are ready — but nothing is loaded until a second
                person approves this run.{" "}
                {startedByMe
                  ? "You started it, so an Admin or another Operations user must approve it."
                  : canApprove
                  ? "You can approve it now."
                  : "An Admin or an Operations user (other than the one who started it) must approve it."}
                </span>
              </Alert>
            ) : !latestRun ? (
              <p className="text-foreground-muted">
                Not run yet. A run validates every row against the rules, then waits for approval
                before loading.
              </p>
            ) : (
              <p className="text-foreground-muted">
                Latest run: <span className="font-medium text-foreground">{latestRun.state.replace(/_/g, " ")}</span>
                {latestRun.finished_at && ` · ${new Date(latestRun.finished_at).toLocaleString()}`}
              </p>
            )}

            <div className="mt-auto flex flex-wrap gap-2">
              {canApprove && (
                <Button disabled={approving} onClick={handleApprove}>
                  {approving ? "Approving…" : "Approve & load"}
                </Button>
              )}
              {can("batch:upload") && (
                <Button variant={canApprove ? "white" : undefined} disabled={running} onClick={handleRun}>
                  {running ? "Starting…" : latestRun ? "Run again" : "Run"}
                </Button>
              )}
              {latestRun && (
                <Link href={`/runs/${latestRun.id}`} className="self-center text-xs text-primary hover:text-primary-dark">
                  Open Run #{latestRun.run_number} →
                </Link>
              )}
            </div>
          </CardBody>
        </Card>
        <ValidationPanel
          gateState={validation?.gate_state ?? dataset.gate_state}
          results={validation?.results ?? []}
          runId={dataset.latest_run_id}
          live={dataset.state === "validating" || dataset.state === "loading"}
        />

      </div>

      <div className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title="Source preview"
              actions={
                <Button variant="white" size="sm" disabled={previewLoading} onClick={loadPreview}>
                  {previewLoading ? "Loading…" : preview ? "Refresh" : "Show original data"}
                </Button>
              }
            />
            <div className="p-4">
              <p className="mb-3 text-xs text-foreground-muted">
                Read fresh from the source file, exactly as parsed — no
                rules or transforms applied. First 200 rows only.
              </p>
              {previewError && <Alert>{previewError}</Alert>}
              {!previewError && preview && (
                <DataGrid
                  rows={preview}
                  columns={dataset.columns.map((c) => c.name)}
                  title={`${dataset.name}-source-preview`}
                />
              )}
            </div>
          </Card>

          <RuleEditor datasetId={dataset.id} columns={dataset.columns} />

          <TransformEditor datasetId={dataset.id} columns={dataset.columns} />

          <Card>
            <CardHeader
              title={`Pinned schema (${dataset.columns.length})`}
              actions={
                dataset.columns.length > 0 && (
                  <Button variant="white" size="sm" iconOnly onClick={() => setSchemaCollapsed((c) => !c)}>
                    <IconChevronRight className={`h-3.5 w-3.5 transition-transform ${schemaCollapsed ? "" : "rotate-90"}`} />
                  </Button>
                )
              }
            />
            <div className="p-4">
              {dataset.columns.length === 0 ? (
                <p className="text-xs text-foreground-muted">
                  No schema inferred yet.
                </p>
              ) : !schemaCollapsed ? (
                <div className="max-w-full overflow-auto rounded-md border-2 border-border" style={{ maxHeight: "50vh" }}>
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 z-10 border-b-2 border-border bg-surface-soft text-xs uppercase tracking-wide text-foreground-muted">
                      <tr>
                        <th className="px-3 py-1.5 font-medium">Column</th>
                        <th className="px-3 py-1.5 font-medium">Type</th>
                        <th className="px-3 py-1.5 font-medium">
                          <span
                            className="inline-flex cursor-help items-center gap-1"
                            title="Read-only. Whether at least one sampled value for this column was blank when the file was first uploaded (up to 10,000 rows) — not a live count, and not a constraint. To actually require a column be non-null, add a Mandatory not_null rule in Validation rules above."
                          >
                            Has blanks in sample
                            <IconInfo className="h-3 w-3" />
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {schemaPager.pageItems.map((c) => (
                        <tr key={c.name} className="border-b border-border last:border-0">
                          <td className="px-3 py-1.5 font-mono text-xs">{c.name}</td>
                          <td className="px-3 py-1.5 text-foreground-muted">{c.type}</td>
                          <td className="px-3 py-1.5 text-foreground-muted">
                            {c.nullable ? "yes" : "no"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {!schemaCollapsed && <Pagination pager={schemaPager} className="mt-2" />}
            </div>
          </Card>

          <RunHistory datasetId={dataset.id} />
      </div>
    </div>
  );
}
