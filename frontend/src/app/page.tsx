"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, deleteDataset, listDatasets, runDataset } from "@/app/lib/api";
import { useAuth } from "@/app/lib/auth-context";
import { GateBadge } from "@/app/components/GateBadge";
import { StateBadge } from "@/app/components/StateBadge";
import { UploadAside } from "@/app/components/UploadAside";
import { Alert, Button, Card, CollapsibleCard, Pagination, usePagination, SortTh } from "@/app/components/ui";
import type { Dataset } from "@/app/lib/types";

export default function DatasetsPage() {
  const { can } = useAuth();
  const canDeleteDatasets = can("dataset:delete");
  const canRun = can("batch:upload");
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pager = usePagination(datasets);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmingBulkTrash, setConfirmingBulkTrash] = useState(false);

  function refresh() {
    listDatasets()
      .then((rows) => {
        setDatasets(rows);
        // Drop selections for datasets that no longer exist (trashed, etc.).
        setSelected((prev) => new Set([...prev].filter((id) => rows.some((r) => r.id === id))));
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "Failed to load datasets.")
      );
  }

  useEffect(refresh, []);

  const allIds = (datasets ?? []).map((d) => d.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }

  async function runSelected() {
    if (!canRun || selected.size === 0) return;
    setBulkBusy(true);
    setError(null);
    const results = await Promise.allSettled([...selected].map((id) => runDataset(id)));
    const failed = results.filter((r) => r.status === "rejected").length;
    setResetMessage(
      `Started ${results.length - failed} run${results.length - failed === 1 ? "" : "s"}` +
        (failed ? ` — ${failed} could not start.` : ".")
    );
    setBulkBusy(false);
    refresh();
  }

  async function trashSelected() {
    if (!canDeleteDatasets || selected.size === 0) return;
    setBulkBusy(true);
    setError(null);
    const results = await Promise.allSettled([...selected].map((id) => deleteDataset(id)));
    const failed = results.filter((r) => r.status === "rejected").length;
    setResetMessage(
      `Moved ${results.length - failed} dataset${results.length - failed === 1 ? "" : "s"} to Trash` +
        (failed ? ` — ${failed} failed.` : ".")
    );
    setBulkBusy(false);
    setConfirmingBulkTrash(false);
    refresh();
  }

  async function confirmDelete(dataset: Dataset) {
    if (!canDeleteDatasets) return;
    setDeletingId(dataset.id);
    setError(null);
    try {
      await deleteDataset(dataset.id);
      setResetMessage(`"${dataset.name}" moved to Trash.`);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to move dataset to Trash.");
    } finally {
      setDeletingId(null);
      setConfirmingDeleteId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Uploads / Datasets</h1>
          <p className="text-sm text-foreground-muted">
            One dataset per discovered entity — sheet, table or record type.
          </p>
        </div>
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
            No datasets yet. Upload a file on the right to discover entities and
            generate mappings automatically.
          </p>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-4 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          {canRun && (
            <Button size="sm" disabled={bulkBusy} onClick={runSelected}>
              {bulkBusy ? "Working…" : "Run selected"}
            </Button>
          )}
          {canDeleteDatasets &&
            (confirmingBulkTrash ? (
              <span className="inline-flex items-center gap-2">
                <span className="text-xs text-foreground-muted">Move {selected.size} to Trash?</span>
                <Button variant="danger" size="sm" disabled={bulkBusy} onClick={trashSelected}>
                  Yes
                </Button>
                <Button variant="white" size="sm" onClick={() => setConfirmingBulkTrash(false)}>
                  No
                </Button>
              </span>
            ) : (
              <Button variant="white" size="sm" onClick={() => setConfirmingBulkTrash(true)}>
                Move to Trash
              </Button>
            ))}
          <Button variant="white" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {datasets !== null && datasets.length > 0 && (
        <CollapsibleCard title={`${datasets.length} dataset${datasets.length === 1 ? "" : "s"}`} footer={<Pagination pager={pager} />}>
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 border-b-2 border-border bg-surface-soft text-xs uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all datasets"
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                </th>
                <SortTh pager={pager} col="name" className="px-4 py-3 font-medium">Dataset</SortTh>
                <SortTh pager={pager} col="client_name" className="px-4 py-3 font-medium">Client</SortTh>
                <SortTh pager={pager} col="source_filename" className="px-4 py-3 font-medium">Source</SortTh>
                <SortTh pager={pager} col="rows" value={(d) => d.row_count ?? d.latest_rows_read} className="px-4 py-3 font-medium">Rows</SortTh>
                <SortTh pager={pager} col="state" className="px-4 py-3 font-medium">State</SortTh>
                <SortTh pager={pager} col="gate_state" className="px-4 py-3 font-medium">Validation</SortTh>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pager.pageItems.map((d) => (
                <tr
                  key={d.id}
                  className={`border-b border-border last:border-0 hover:bg-surface-soft ${
                    selected.has(d.id) ? "bg-primary-soft/40" : ""
                  }`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${d.name}`}
                      checked={selected.has(d.id)}
                      onChange={() => toggleOne(d.id)}
                    />
                  </td>
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
                    {d.client_name ? (
                      <>
                        {d.client_name}
                        {d.domain_name && <div className="text-xs">{d.domain_name}</div>}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {d.source_filename}
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {d.row_count ?? (d.latest_rows_read != null ? (
                      <span title="Read by the latest run; not loaded yet">{d.latest_rows_read}*</span>
                    ) : (
                      "—"
                    ))}
                  </td>
                  <td className="px-4 py-3">
                    <StateBadge state={d.state} />
                  </td>
                  <td className="px-4 py-3">
                    <GateBadge state={d.gate_state} />
                  </td>
                  <td className="px-4 py-3">
                    {!canDeleteDatasets ? null : confirmingDeleteId === d.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-foreground-muted">Move to Trash?</span>
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
                        Trash
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
    </div>
    {can("batch:upload") && (
      <UploadAside
        onUploaded={(created) => {
          setSelected(new Set(created.map((d) => d.id)));
          refresh();
        }}
      />
    )}
    </div>
  );
}
