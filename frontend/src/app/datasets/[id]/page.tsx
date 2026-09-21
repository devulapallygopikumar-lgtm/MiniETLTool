"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError, getDataset, getRunValidation, runDataset } from "@/app/lib/api";
import { GateBadge } from "@/app/components/GateBadge";
import { StateBadge } from "@/app/components/StateBadge";
import { ValidationPanel } from "@/app/components/ValidationPanel";
import { RuleEditor } from "@/app/components/RuleEditor";
import { Alert, Breadcrumb, Button, Card, CardHeader } from "@/app/components/ui";
import type { Dataset, RunValidation } from "@/app/lib/types";

export default function DatasetPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [validation, setValidation] = useState<RunValidation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

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

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[320px_1fr]">
        <ValidationPanel
          gateState={validation?.gate_state ?? dataset.gate_state}
          results={validation?.results ?? []}
          runId={dataset.latest_run_id}
          live={
            dataset.state === "validating" || dataset.state === "loading"
          }
        />

        <div className="flex flex-col gap-6">
          <RuleEditor datasetId={dataset.id} columns={dataset.columns} />

          <Card>
            <CardHeader title="Pinned schema" />
            <div className="p-4">
              {dataset.columns.length === 0 ? (
                <p className="text-xs text-foreground-muted">
                  No schema inferred yet.
                </p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-foreground-muted">
                    <tr>
                      <th className="py-1.5 font-medium">Column</th>
                      <th className="py-1.5 font-medium">Type</th>
                      <th className="py-1.5 font-medium">Nullable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dataset.columns.map((c) => (
                      <tr key={c.name} className="border-t border-border">
                        <td className="py-1.5 font-mono text-xs">{c.name}</td>
                        <td className="py-1.5 text-foreground-muted">{c.type}</td>
                        <td className="py-1.5 text-foreground-muted">
                          {c.nullable ? "yes" : "no"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
