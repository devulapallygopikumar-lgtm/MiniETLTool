"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, deleteDataset, listDatasets, resetEverything } from "@/app/lib/api";
import { GateBadge } from "@/app/components/GateBadge";
import { StateBadge } from "@/app/components/StateBadge";
import { Alert, Button, Card, CardHeader, CollapsibleCard, Pagination, usePagination, IconUpload } from "@/app/components/ui";
import type { Dataset } from "@/app/lib/types";

export default function DatasetsPage() {
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pager = usePagination(datasets);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function refresh() {
    listDatasets()
      .then(setDatasets)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "Failed to load datasets.")
      );
  }

  useEffect(refresh, []);

  async function confirmReset() {
    setResetting(true);
    setError(null);
    try {
      const summary = await resetEverything();
      setResetMessage(
        `Reset complete: ${summary.datasets} dataset(s), ${summary.runs} run(s), ` +
          `${summary.loaded_rows} loaded row(s) deleted.`
      );
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to reset.");
    } finally {
      setResetting(false);
      setConfirmingReset(false);
    }
  }

  async function confirmDelete(dataset: Dataset) {
    setDeletingId(dataset.id);
    setError(null);
    try {
      await deleteDataset(dataset.id);
      setResetMessage(`"${dataset.name}" deleted.`);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete dataset.");
    } finally {
      setDeletingId(null);
      setConfirmingDeleteId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Datasets</h1>
          <p className="text-sm text-foreground-muted">
            One dataset per discovered entity — sheet, table or record type.
          </p>
        </div>
        <Button href="/upload">
          <IconUpload />
          Upload a source
        </Button>
      </div>

      {error && <Alert>{error}</Alert>}

      {!error && datasets === null && (
        <Card>
          <div className="px-4 py-6 text-center text-sm text-foreground-muted">
            Loading datasets…
          </div>
        </Card>
      )}

      {datasets !== null && datasets.length === 0 && !error && (
        <div className="rounded-md border border-dashed border-border bg-surface px-4 py-10 text-center">
          <p className="text-sm text-foreground-muted">
            No datasets yet. Upload a file to discover entities and generate
            mappings automatically.
          </p>
          <Button href="/upload" variant="outline" size="sm" className="mt-3">
            Upload your first source →
          </Button>
        </div>
      )}

      {datasets !== null && datasets.length > 0 && (
        <CollapsibleCard title={`${datasets.length} dataset${datasets.length === 1 ? "" : "s"}`} footer={<Pagination pager={pager} />}>
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 border-b-2 border-border bg-surface-soft text-xs uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Dataset</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Rows</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Validation</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pager.pageItems.map((d) => (
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
                  <td className="px-4 py-3">
                    {confirmingDeleteId === d.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-foreground-muted">Delete?</span>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={deletingId === d.id}
                          onClick={() => confirmDelete(d)}
                        >
                          {deletingId === d.id ? "…" : "Yes"}
                        </Button>
                        <Button
                          variant="white"
                          size="sm"
                          disabled={deletingId === d.id}
                          onClick={() => setConfirmingDeleteId(null)}
                        >
                          No
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="white"
                        size="sm"
                        className="border-0 text-foreground-muted hover:text-danger"
                        onClick={() => setConfirmingDeleteId(d.id)}
                      >
                        Delete
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsibleCard>
      )}

      {resetMessage && <Alert variant="success">{resetMessage}</Alert>}

      <Card>
        <CardHeader title="Danger zone" />
        <div className="flex flex-col gap-3 p-4">
          <p className="text-xs text-foreground-muted">
            Permanently delete every dataset, mapping, rule, transform and
            run — all staged, rejected and loaded rows, every typed table
            they produced, and the entire audit log. This cannot be undone.
          </p>
          {!confirmingReset && (
            <Button
              variant="danger"
              size="sm"
              className="self-start"
              onClick={() => setConfirmingReset(true)}
            >
              Reset all data
            </Button>
          )}
          {confirmingReset && (
            <div className="flex items-center gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2">
              <span className="text-sm font-medium">
                Are you sure? This deletes{" "}
                {datasets?.length ?? 0} dataset{datasets?.length === 1 ? "" : "s"} and all run history.
              </span>
              <Button variant="danger" size="sm" disabled={resetting} onClick={confirmReset}>
                {resetting ? "Resetting…" : "Yes, reset everything"}
              </Button>
              <Button
                variant="white"
                size="sm"
                disabled={resetting}
                onClick={() => setConfirmingReset(false)}
              >
                No, cancel
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
