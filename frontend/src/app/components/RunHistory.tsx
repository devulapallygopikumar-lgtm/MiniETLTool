"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, listRuns } from "@/app/lib/api";
import type { Run } from "@/app/lib/types";
import { Alert, Button, Card, CardHeader, IconChevronRight, Pagination, usePagination } from "@/app/components/ui";
import { GateBadge } from "@/app/components/GateBadge";
import { StateBadge } from "@/app/components/StateBadge";

export function RunHistory({ datasetId }: { datasetId: string }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const pager = usePagination(runs);

  useEffect(() => {
    let cancelled = false;
    listRuns(datasetId)
      .then((r) => {
        if (!cancelled) setRuns(r);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load run history.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  return (
    <Card>
      <CardHeader
        title="Run history"
        actions={
          runs !== null &&
          runs.length > 0 && (
            <Button variant="white" size="sm" iconOnly onClick={() => setCollapsed((c) => !c)}>
              <IconChevronRight className={`h-3.5 w-3.5 transition-transform ${collapsed ? "" : "rotate-90"}`} />
            </Button>
          )
        }
      />
      <div className="p-4 pt-0">
        {error && <Alert>{error}</Alert>}

        {!error && runs === null && (
          <p className="text-xs text-foreground-muted">Loading run history…</p>
        )}

        {runs !== null && runs.length === 0 && (
          <p className="text-xs text-foreground-muted">
            No runs yet — this fills in once you click Run above.
          </p>
        )}

        {runs !== null && runs.length > 0 && !collapsed && (
          <div className="max-w-full overflow-auto rounded-md border-2 border-border" style={{ maxHeight: "50vh" }}>
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 border-b-2 border-border bg-surface-soft text-xs uppercase tracking-wide text-foreground-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium">Validation</th>
                  <th className="px-3 py-2 font-medium">Read</th>
                  <th className="px-3 py-2 font-medium">Written</th>
                  <th className="px-3 py-2 font-medium">Rejected</th>
                </tr>
              </thead>
              <tbody>
                {pager.pageItems.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-soft">
                    <td className="px-3 py-2">
                      <Link href={`/runs/${r.id}`} className="text-primary hover:text-primary-dark">
                        {new Date(r.created_at).toLocaleString()}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <StateBadge state={r.state} />
                    </td>
                    <td className="px-3 py-2">
                      <GateBadge state={r.gate_state} />
                    </td>
                    <td className="px-3 py-2 text-foreground-muted">{r.rows_read.toLocaleString()}</td>
                    <td className="px-3 py-2 text-foreground-muted">{r.rows_written.toLocaleString()}</td>
                    <td className={`px-3 py-2 ${r.rows_rejected > 0 ? "text-danger" : "text-foreground-muted"}`}>
                      {r.rows_rejected.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {runs !== null && !collapsed && <Pagination pager={pager} className="mt-2" />}
      </div>
    </Card>
  );
}
