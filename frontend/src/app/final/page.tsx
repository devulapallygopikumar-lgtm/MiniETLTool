"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, listDatasets } from "@/app/lib/api";
import { Alert, Card, CardHeader } from "@/app/components/ui";
import type { Dataset } from "@/app/lib/types";

export default function FinalDatasetsPage() {
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDatasets()
      .then((data) => {
        if (!cancelled) setDatasets(data.filter((d) => d.row_count !== null));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load datasets.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Final Datasets</h1>
        <p className="text-sm text-foreground-muted">
          Datasets that have completed at least one successful load — the
          output of the pipeline, not the raw upload.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      {!error && datasets === null && (
        <Card>
          <div className="px-4 py-6 text-center text-sm text-foreground-muted">
            Loading…
          </div>
        </Card>
      )}

      {datasets !== null && datasets.length === 0 && !error && (
        <div className="rounded-md border border-dashed border-border bg-surface px-4 py-10 text-center">
          <p className="text-sm text-foreground-muted">
            Nothing here yet — a dataset shows up once its gate has opened
            and a run has loaded it at least once.
          </p>
        </div>
      )}

      {datasets !== null && datasets.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader
            title={`${datasets.length} final dataset${datasets.length === 1 ? "" : "s"}`}
          />
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-soft text-xs uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Dataset</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Rows loaded</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0 hover:bg-surface-soft">
                  <td className="px-4 py-3">
                    <Link href={`/final/${d.id}`} className="font-medium text-foreground hover:text-primary">
                      {d.name}
                    </Link>
                    <div className="text-xs text-foreground-muted">{d.entity_name}</div>
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {d.source_filename}
                    <span className="ml-1 text-xs uppercase">({d.format})</span>
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {d.row_count?.toLocaleString() ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
