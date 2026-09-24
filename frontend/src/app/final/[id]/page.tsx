"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ApiError, getDataset, previewLoaded } from "@/app/lib/api";
import { DataGrid } from "@/app/components/DataGrid";
import { Alert, Breadcrumb, Button, Card, CardHeader } from "@/app/components/ui";
import type { Dataset } from "@/app/lib/types";

const PAGE_SIZE = 50;

export default function FinalDatasetPage() {
  const { id } = useParams<{ id: string }>();

  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDataset(id)
      .then(setDataset)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "Failed to load dataset.")
      );
  }, [id]);

  useEffect(() => {
    previewLoaded(id, limit)
      .then(setRows)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "Failed to load rows.")
      );
  }, [id, limit]);

  if (error && !dataset) {
    return <Alert>{error}</Alert>;
  }

  if (!dataset) {
    return <p className="text-sm text-foreground-muted">Loading dataset…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Breadcrumb
          items={[{ label: "Final Datasets", href: "/final" }, { label: dataset.name }]}
        />
        <h1 className="text-xl font-semibold">{dataset.name}</h1>
        <p className="text-sm text-foreground-muted">
          {dataset.source_filename} · {dataset.entity_name} ·{" "}
          {dataset.row_count?.toLocaleString() ?? "?"} rows loaded
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      <Card>
        <CardHeader
          title="Loaded data"
          actions={
            <Button variant="white" href={`/datasets/${dataset.id}`} size="sm">
              Configure this dataset
            </Button>
          }
        />
        <div className="p-4">
          <p className="mb-3 text-xs text-foreground-muted">
            The output of the pipeline — rules and transforms already
            applied, from the most recent successful run.
          </p>
          {rows === null && !error && (
            <p className="text-xs text-foreground-muted">Loading rows…</p>
          )}
          {/* No explicit columns: the loaded shape can differ from the
              pinned source schema (rename/derive/cast/sequence/project
              transforms all change it), so DataGrid derives headers from
              the actual returned rows instead. */}
          {rows !== null && <DataGrid rows={rows} title={`${dataset.name}-loaded`} />}
          {rows !== null && rows.length >= limit && (
            <Button
              variant="white"
              size="sm"
              className="mt-3"
              onClick={() => setLimit((l) => l + PAGE_SIZE)}
            >
              Load more
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
