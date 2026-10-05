"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, deleteDataset, listDatasets, listTargetMappings, runDataset } from "@/app/lib/api";
import { useAuth } from "@/app/lib/auth-context";
import { StateBadge } from "@/app/components/StateBadge";
import { Alert, Breadcrumb, Button, Card, Pagination, SortTh, usePagination } from "@/app/components/ui";
import type { Dataset, TargetMapping } from "@/app/lib/types";

type Status = "pending" | "attention" | "completed" | "finalised";

// Where a dataset is on its way from upload to target:
//   pending    -- uploaded/discovered but not (successfully) loaded yet
//   attention  -- the last run failed or didn't pass validation
//   completed  -- loaded; its rows are ready
//   finalised  -- loaded AND mapped onto a target table
const STATUSES: { id: Status; label: string; hint: string; tone: string }[] = [
  { id: "pending", label: "Pending", hint: "Not loaded yet", tone: "text-warning" },
  { id: "attention", label: "Needs attention", hint: "Failed or didn't pass validation", tone: "text-danger" },
  { id: "completed", label: "Completed", hint: "Loaded, not mapped to a target yet", tone: "text-foreground" },
  { id: "finalised", label: "Finalised", hint: "Loaded and mapped to a target table", tone: "text-success" },
];

function statusOf(d: Dataset, mapped: Set<string>): Status {
  if (d.state === "failed" || d.state === "validation_failed") return "attention";
  if (d.state === "loaded" || d.row_count !== null) return mapped.has(d.id) ? "finalised" : "completed";
  return "pending";
}

const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label])) as Record<Status, string>;

export default function DashboardPage() {
  const { user, can } = useAuth();
  const canRun = can("batch:upload");
  const canTrash = can("dataset:delete");

  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  const [mappings, setMappings] = useState<TargetMapping[]>([]);
  const [filter, setFilter] = useState<Status | "all">("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    Promise.all([listDatasets(), listTargetMappings()])
      .then(([d, m]) => {
        setDatasets(d);
        setMappings(m);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load the dashboard."));
  }, []);

  // Load on mount, and again whenever the tab regains focus (a run or a
  // mapping finished in another tab shouldn't leave this stale).
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const mapped = useMemo(() => new Set(mappings.map((m) => m.dataset_id)), [mappings]);
  const targetOf = useMemo(() => {
    const byDataset = new Map<string, string>();
    for (const m of mappings) {
      byDataset.set(m.dataset_id, `${m.connection_name} · ${m.target_schema}.${m.target_table}`);
    }
    return byDataset;
  }, [mappings]);

  const rows = useMemo(
    () => (datasets ?? []).map((d) => ({ d, status: statusOf(d, mapped) })),
    [datasets, mapped]
  );
  const counts = useMemo(() => {
    const c: Record<Status, number> = { pending: 0, attention: 0, completed: 0, finalised: 0 };
    rows.forEach((r) => c[r.status]++);
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (filter === "all" || r.status === filter) &&
        (!q ||
          `${r.d.name} ${r.d.entity_name} ${r.d.client_name ?? ""} ${r.d.source_filename}`.toLowerCase().includes(q))
    );
  }, [rows, filter, search]);
  const pager = usePagination(visible);

  async function run(d: Dataset) {
    setBusyId(d.id);
    setError(null);
    setMessage(null);
    try {
      await runDataset(d.id);
      setMessage(`Run started for "${d.name}".`);
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start the run.");
    } finally {
      setBusyId(null);
    }
  }

  async function trash(d: Dataset) {
    setBusyId(d.id);
    setError(null);
    setMessage(null);
    try {
      await deleteDataset(d.id);
      setMessage(`"${d.name}" moved to Trash.`);
      setConfirmingId(null);
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not move the dataset to Trash.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Breadcrumb items={[{ label: "Dashboard" }]} />
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-foreground-muted">
            Welcome{user ? `, ${user.email}` : ""}. Every table (dataset) and where it stands — open one to work on it,
            run it, or finish mapping it to a target.
          </p>
        </div>
        <Button variant="white" size="sm" onClick={refresh}>
          Refresh
        </Button>
      </div>

      {error && <Alert>{error}</Alert>}
      {message && <Alert variant="success">{message}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATUSES.map((s) => {
          const active = filter === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setFilter(active ? "all" : s.id)}
              title={s.hint}
              className={`rounded-lg border bg-surface p-4 text-left transition-colors hover:bg-surface-soft ${
                active ? "border-primary ring-1 ring-primary" : "border-border"
              }`}
            >
              <div className={`text-3xl font-semibold ${s.tone}`}>{datasets === null ? "–" : counts[s.id]}</div>
              <div className="mt-1 text-sm font-medium">{s.label}</div>
              <div className="text-xs text-foreground-muted">{s.hint}</div>
            </button>
          );
        })}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">
            {filter === "all" ? "All tables" : STATUS_LABEL[filter]}
            <span className="ml-1.5 font-normal text-foreground-muted">({visible.length})</span>
          </h2>
          {filter !== "all" && (
            <Button variant="white" size="sm" onClick={() => setFilter("all")}>
              Show all
            </Button>
          )}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, client or file…"
            className="ml-auto w-64 max-w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          />
        </div>

        {datasets === null && !error && (
          <p className="px-4 py-6 text-center text-sm text-foreground-muted">Loading…</p>
        )}
        {datasets !== null && datasets.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-foreground-muted">
            No tables yet.{" "}
            <Link href="/" className="text-primary hover:text-primary-dark">
              Upload a file
            </Link>{" "}
            to get started.
          </p>
        )}
        {datasets !== null && datasets.length > 0 && visible.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-foreground-muted">Nothing matches.</p>
        )}

        {visible.length > 0 && (
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 border-b-2 border-border bg-surface-soft text-xs uppercase tracking-wide text-foreground-muted">
                <tr>
                  <SortTh pager={pager} col="name" value={(r) => r.d.name}>Table</SortTh>
                  <SortTh pager={pager} col="client" value={(r) => r.d.client_name}>Client</SortTh>
                  <SortTh pager={pager} col="status" value={(r) => STATUS_LABEL[r.status]}>Status</SortTh>
                  <SortTh pager={pager} col="state" value={(r) => r.d.state}>State</SortTh>
                  <SortTh pager={pager} col="rows" value={(r) => r.d.row_count ?? r.d.latest_rows_read}>Rows</SortTh>
                  <SortTh pager={pager} col="target" value={(r) => targetOf.get(r.d.id)}>Target</SortTh>
                  <SortTh pager={pager} col="created" value={(r) => r.d.created_at}>Created</SortTh>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.pageItems.map(({ d, status }) => (
                  <tr key={d.id} className="border-b border-border last:border-0 hover:bg-surface-soft">
                    <td className="px-4 py-3">
                      <Link href={`/datasets/${d.id}`} className="font-medium hover:text-primary">
                        {d.name}
                      </Link>
                      <div className="text-xs text-foreground-muted">{d.entity_name}</div>
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">{d.client_name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-semibold ${STATUSES.find((s) => s.id === status)?.tone ?? ""}`}
                      >
                        {STATUS_LABEL[status]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StateBadge state={d.state} />
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">
                      {d.row_count ?? (d.latest_rows_read != null ? `${d.latest_rows_read}*` : "—")}
                    </td>
                    <td className="px-4 py-3 text-xs text-foreground-muted">{targetOf.get(d.id) ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-foreground-muted">
                      {new Date(d.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {confirmingId === d.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-foreground-muted">Move to Trash?</span>
                          <Button variant="danger" size="sm" disabled={busyId === d.id} onClick={() => trash(d)}>
                            Yes
                          </Button>
                          <Button variant="white" size="sm" onClick={() => setConfirmingId(null)}>
                            No
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          <Link
                            href={`/datasets/${d.id}`}
                            className="inline-flex h-7 items-center rounded-md border border-border bg-surface px-2.5 text-xs font-medium hover:bg-surface-soft"
                          >
                            Open
                          </Link>
                          {canRun && (status === "pending" || status === "attention") && (
                            <Button size="sm" disabled={busyId === d.id} onClick={() => run(d)}>
                              {busyId === d.id ? "…" : status === "attention" ? "Retry" : "Run"}
                            </Button>
                          )}
                          {(status === "completed" || status === "finalised") && (
                            <Link
                              href={`/final/${d.id}`}
                              className="inline-flex h-7 items-center rounded-md border border-border bg-surface px-2.5 text-xs font-medium hover:bg-surface-soft"
                            >
                              View data
                            </Link>
                          )}
                          {can("mapping:manage") && status === "completed" && (
                            <Link
                              href="/mapping"
                              className="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-white hover:bg-primary-dark"
                            >
                              Map to target
                            </Link>
                          )}
                          {canTrash && (
                            <Button variant="white" size="sm" onClick={() => setConfirmingId(d.id)}>
                              Trash
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {visible.length > 0 && <Pagination pager={pager} className="px-4 py-3" />}
      </Card>
      <p className="text-xs text-foreground-muted">
        * rows read by the latest run, not loaded yet. Click a tile to filter; click it again to clear.
      </p>
    </div>
  );
}
