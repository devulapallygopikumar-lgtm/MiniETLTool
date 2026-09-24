"use client";

import { useEffect, useState } from "react";
import { ApiError, listAuditEvents } from "@/app/lib/api";
import { Alert, CollapsibleCard } from "@/app/components/ui";
import type { AuditEvent } from "@/app/lib/types";

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAuditEvents()
      .then(setEvents)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "Failed to load audit log.")
      );
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p className="text-sm text-foreground-muted">
          Every state change, append-only (ARCHITECTURE.md §10).
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      {!error && events === null && (
        <p className="text-sm text-foreground-muted">Loading audit events…</p>
      )}

      {events !== null && events.length === 0 && !error && (
        <p className="text-sm text-foreground-muted">No audit events yet.</p>
      )}

      {events !== null && events.length > 0 && (
        <CollapsibleCard title={`${events.length} audit event${events.length === 1 ? "" : "s"}`}>
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 border-b-2 border-border bg-surface-soft text-xs uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Actor</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Resource</th>
                <th className="px-4 py-3 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr
                  key={e.id}
                  className="border-b border-border last:border-0 hover:bg-surface-soft"
                >
                  <td className="px-4 py-3 text-foreground-muted">
                    {new Date(e.occurred_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">{e.actor}</td>
                  <td className="px-4 py-3 font-mono text-xs">{e.action}</td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {e.resource_type}
                    <span className="ml-1 text-xs">({e.resource_id})</span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        e.outcome === "success"
                          ? "text-success"
                          : "text-danger"
                      }
                    >
                      {e.outcome}
                    </span>
                    {e.reason && (
                      <span className="ml-1 text-xs text-foreground-muted">
                        — {e.reason}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsibleCard>
      )}
    </div>
  );
}
