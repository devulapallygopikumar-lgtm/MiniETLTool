"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, listDatasets } from "@/app/lib/api";
import { GateBadge } from "@/app/components/GateBadge";
import { StateBadge } from "@/app/components/StateBadge";
import type { Dataset } from "@/app/lib/types";

export default function DatasetsPage() {
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDatasets()
      .then((data) => {
        if (!cancelled) setDatasets(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Failed to load datasets."
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Datasets</h1>
          <p className="text-sm text-foreground-muted">
            One dataset per discovered entity — sheet, table or record type.
          </p>
        </div>
        <Link
          href="/upload"
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
        >
          Upload a source
        </Link>
      </div>

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {!error && datasets === null && (
        <div className="rounded-md border border-border bg-surface px-4 py-6 text-center text-sm text-foreground-muted">
          Loading datasets…
        </div>
      )}

      {datasets !== null && datasets.length === 0 && !error && (
        <div className="rounded-md border border-dashed border-border bg-surface px-4 py-10 text-center">
          <p className="text-sm text-foreground-muted">
            No datasets yet. Upload a file to discover entities and generate
            mappings automatically.
          </p>
          <Link
            href="/upload"
            className="mt-3 inline-block text-sm font-semibold text-primary hover:text-primary-dark"
          >
            Upload your first source →
          </Link>
        </div>
      )}

      {datasets !== null && datasets.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-soft text-xs uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Dataset</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Rows</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Gate</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((d) => (
                <tr
                  key={d.id}
                  className="border-b border-border last:border-0 hover:bg-surface-soft"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/datasets/${d.id}`}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {d.name}
                    </Link>
                    <div className="text-xs text-foreground-muted">
                      {d.entity_name}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {d.source_filename}
                    <span className="ml-1 text-xs uppercase">
                      ({d.format})
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {d.row_count ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StateBadge state={d.state} />
                  </td>
                  <td className="px-4 py-3">
                    <GateBadge state={d.gate_state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
