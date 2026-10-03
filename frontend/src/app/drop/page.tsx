"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  deleteDataset,
  dropDatasetPermanently,
  emptyTrash,
  listDatasets,
  listTrash,
  resetEverything,
  restoreDataset,
} from "@/app/lib/api";
import { useAuth } from "@/app/lib/auth-context";
import { Alert, Breadcrumb, Button, Card, CardBody, CardHeader } from "@/app/components/ui";
import type { Dataset } from "@/app/lib/types";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

export default function DropDatasetsPage() {
  const { can } = useAuth();
  const allowed = can("dataset:delete");
  const [active, setActive] = useState<Dataset[]>([]);
  const [trash, setTrash] = useState<Dataset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One confirmation at a time, keyed so a click on another row replaces it.
  const [confirming, setConfirming] = useState<string | null>(null);

  function refresh() {
    listDatasets().then(setActive).catch((e) => fail(e, "Failed to load datasets."));
    listTrash().then(setTrash).catch((e) => fail(e, "Failed to load the Trash."));
  }

  function fail(err: unknown, fallback: string) {
    setError(err instanceof ApiError ? err.message : fallback);
  }

  useEffect(() => {
    if (allowed) refresh();
  }, [allowed]);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(label);
      refresh();
    } catch (err) {
      fail(err, "That didn't work. Try again.");
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  if (!allowed) return <Alert>Only an Admin can drop datasets.</Alert>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Breadcrumb items={[{ label: "Drop Datasets" }]} />
        <h1 className="text-xl font-semibold">Drop Datasets</h1>
        <p className="text-sm text-foreground-muted">
          Dropped datasets go to the Trash first and can be restored. They are only gone for good
          when you drop them from the Trash.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}
      {message && <Alert variant="success">{message}</Alert>}

      <Card>
        <CardHeader title={`Datasets — ${active.length}`} />
        {active.length === 0 ? (
          <p className="px-4 py-4 text-sm text-foreground-muted">No active datasets.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {active.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{d.name}</div>
                    <div className="text-xs text-foreground-muted">
                      {[d.domain_name, d.client_name].filter(Boolean).join(" › ") || "no client"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {confirming === `trash:${d.id}` ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-xs text-foreground-muted">Move to Trash?</span>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={busy}
                          onClick={() => run(`"${d.name}" moved to Trash.`, () => deleteDataset(d.id))}
                        >
                          Yes
                        </Button>
                        <Button variant="white" size="sm" onClick={() => setConfirming(null)}>
                          No
                        </Button>
                      </span>
                    ) : (
                      <Button variant="white" size="sm" onClick={() => setConfirming(`trash:${d.id}`)}>
                        Drop to Trash
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <CardHeader title={`Trash — ${trash.length}`} />
        {trash.length === 0 ? (
          <p className="px-4 py-4 text-sm text-foreground-muted">The Trash is empty.</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <tbody>
                {trash.map((d) => (
                  <tr key={d.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{d.name}</div>
                      <div className="text-xs text-foreground-muted">
                        {[d.domain_name, d.client_name].filter(Boolean).join(" › ") || "no client"} · trashed{" "}
                        {fmt(d.deleted_at)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {confirming === `drop:${d.id}` ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-xs text-foreground-muted">Gone for good?</span>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={busy}
                            onClick={() => run(`"${d.name}" dropped permanently.`, () => dropDatasetPermanently(d.id))}
                          >
                            Yes, drop
                          </Button>
                          <Button variant="white" size="sm" onClick={() => setConfirming(null)}>
                            No
                          </Button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-2">
                          <Button
                            variant="white"
                            size="sm"
                            disabled={busy}
                            onClick={() => run(`"${d.name}" restored.`, () => restoreDataset(d.id))}
                          >
                            Restore
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => setConfirming(`drop:${d.id}`)}>
                            Drop permanently
                          </Button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-border px-4 py-3">
              {confirming === "empty" ? (
                <span className="inline-flex items-center gap-2">
                  <span className="text-sm font-medium">
                    Permanently drop all {trash.length} dataset{trash.length === 1 ? "" : "s"} in the Trash?
                  </span>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy}
                    onClick={() => run("Trash emptied.", emptyTrash)}
                  >
                    Yes, empty Trash
                  </Button>
                  <Button variant="white" size="sm" onClick={() => setConfirming(null)}>
                    No
                  </Button>
                </span>
              ) : (
                <Button variant="danger" size="sm" onClick={() => setConfirming("empty")}>
                  Empty Trash
                </Button>
              )}
            </div>
          </>
        )}
      </Card>

      {can("tenant:manage") && (
        <Card>
          <CardHeader title="Danger zone" />
          <CardBody className="flex flex-col gap-3">
            <p className="text-xs text-foreground-muted">
              Permanently delete every dataset (Trash included), mapping, rule, transform and run — all
              staged, rejected and loaded rows, every typed table they produced, and the entire audit
              log. This skips the Trash and cannot be undone.
            </p>
            {confirming === "reset" ? (
              <div className="flex items-center gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2">
                <span className="text-sm font-medium">Are you sure? Everything is deleted for good.</span>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run("Reset complete.", async () => {
                      await resetEverything();
                    })
                  }
                >
                  Yes, reset everything
                </Button>
                <Button variant="white" size="sm" onClick={() => setConfirming(null)}>
                  No, cancel
                </Button>
              </div>
            ) : (
              <Button variant="danger" size="sm" className="self-start" onClick={() => setConfirming("reset")}>
                Reset all data
              </Button>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
