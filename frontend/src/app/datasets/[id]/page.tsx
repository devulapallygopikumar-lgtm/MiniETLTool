"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError, getDataset, getRunValidation, previewDataset, runDataset } from "@/app/lib/api";
import { GateBadge } from "@/app/components/GateBadge";
import { StateBadge } from "@/app/components/StateBadge";
import { ValidationPanel } from "@/app/components/ValidationPanel";
import { RuleEditor } from "@/app/components/RuleEditor";
import { TransformEditor } from "@/app/components/TransformEditor";
import { RunHistory } from "@/app/components/RunHistory";
import { DataGrid } from "@/app/components/DataGrid";
import { Alert, Breadcrumb, Button, Card, CardHeader, IconChevronRight, IconInfo, Pagination, usePagination } from "@/app/components/ui";
import type { Dataset, RunValidation } from "@/app/lib/types";

export default function DatasetPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [validation, setValidation] = useState<RunValidation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<Record<string, unknown>[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [schemaCollapsed, setSchemaCollapsed] = useState(false);
  const schemaPager = usePagination(dataset?.columns);
  const previewCardRef = useRef<HTMLDivElement>(null);

  function refresh() {
    getDataset(id)
      .then((d) => {
        setDataset(d);
        if (d.latest_run_id) {
          getRunValidation(d.latest_run_id)
            .then(setValidation)
            .catch(() => setValidation(null));
        }
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "Failed to load dataset.")
      );
  }

  useEffect(refresh, [id]);

  // Clicking a dataset from a list (Home, Final Datasets, Process Data)
  // lands here at the top of the page, with the grid itself -- Source
  // preview -- below the Validation/Rules/Transforms cards. Jump straight
  // to it instead of making people scroll. Keyed on dataset.id rather
  // than the route's id: the page renders a "Loading dataset..."
  // placeholder (no card, no ref) until the fetch resolves, so scrolling
  // any earlier would find nothing to scroll to.
  useEffect(() => {
    if (dataset?.id) {
      previewCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [dataset?.id]);

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

  if (error && !dataset) {
    return <Alert>{error}</Alert>;
  }

  if (!dataset) {
    return <p className="text-sm text-foreground-muted">Loading dataset…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Breadcrumb
            items={[{ label: "Datasets", href: "/" }, { label: dataset.name }]}
          />
          <h1 className="text-xl font-semibold">{dataset.name}</h1>
          <p className="text-sm text-foreground-muted">
            {dataset.source_filename} · {dataset.entity_name} ·{" "}
            {dataset.row_count ?? "?"} rows
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StateBadge state={dataset.state} />
          <GateBadge state={dataset.gate_state} />
          <Button disabled={running} onClick={handleRun}>
            {running ? "Starting…" : "Run"}
          </Button>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[320px_minmax(0,1fr)]">
        <ValidationPanel
          gateState={validation?.gate_state ?? dataset.gate_state}
          results={validation?.results ?? []}
          runId={dataset.latest_run_id}
          live={
            dataset.state === "validating" || dataset.state === "loading"
          }
        />

        <div className="flex flex-col gap-6">
          <Card>
            <div ref={previewCardRef} />
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
    </div>
  );
}
