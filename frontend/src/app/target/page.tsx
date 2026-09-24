"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  createConnection,
  deleteConnection,
  listConnections,
  testConnection,
  updateConnection,
} from "@/app/lib/api";
import { Alert, Button, Card, CardHeader, CollapsibleCard, Pagination, usePagination, FormField, IconPlus } from "@/app/components/ui";
import type { Connection, ConnectionKind, NewConnection } from "@/app/lib/types";

const inputClass = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm";

const KINDS: { value: ConnectionKind; label: string; defaultPort: number }[] = [
  { value: "postgres", label: "PostgreSQL", defaultPort: 5432 },
  { value: "mysql", label: "MySQL", defaultPort: 3306 },
  { value: "sqlserver", label: "SQL Server", defaultPort: 1433 },
];

function defaultPort(kind: ConnectionKind): number {
  return KINDS.find((k) => k.value === kind)?.defaultPort ?? 5432;
}

function emptyDraft(): NewConnection {
  return {
    name: "",
    kind: "postgres",
    host: "",
    port: defaultPort("postgres"),
    database: "",
    username: "",
    password: "",
    schema_name: "",
  };
}

function statusLabel(c: Connection): { text: string; className: string } {
  if (c.last_test_ok === null) {
    return { text: "Never tested", className: "text-foreground-muted" };
  }
  if (c.last_test_ok) {
    return { text: "Connected", className: "text-success" };
  }
  return { text: "Failed", className: "text-danger" };
}

export default function TargetDatasetPage() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pager = usePagination(connections);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NewConnection>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  function refresh() {
    listConnections()
      .then(setConnections)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "Failed to load connections.")
      );
  }

  useEffect(refresh, []);

  function startAdd() {
    setDraft(emptyDraft());
    setEditingId(null);
    setAdding(true);
  }

  function startEdit(c: Connection) {
    setDraft({
      name: c.name,
      kind: c.kind,
      host: c.host,
      port: c.port,
      database: c.database,
      username: c.username,
      password: "",
      schema_name: c.schema_name ?? "",
    });
    setEditingId(c.id);
    setAdding(true);
  }

  function cancel() {
    setAdding(false);
    setEditingId(null);
    setDraft(emptyDraft());
  }

  function onKindChange(kind: ConnectionKind) {
    setDraft((d) => ({
      ...d,
      kind,
      port: d.port === defaultPort(d.kind) ? defaultPort(kind) : d.port,
    }));
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await updateConnection(editingId, draft);
      } else {
        await createConnection(draft);
      }
      cancel();
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save connection.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Connection) {
    setConnections((cs) => (cs ? cs.filter((x) => x.id !== c.id) : cs));
    try {
      await deleteConnection(c.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete connection.");
      refresh();
    }
  }

  async function runTest(c: Connection) {
    setTestingId(c.id);
    setError(null);
    try {
      await testConnection(c.id);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to test connection.");
    } finally {
      setTestingId(null);
    }
  }

  const canSubmit = Boolean(
    draft.name.trim() &&
      draft.host.trim() &&
      draft.database.trim() &&
      draft.username.trim() &&
      (editingId ? true : draft.password.trim())
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Target Dataset</h1>
          <p className="text-sm text-foreground-muted">
            RDBMS connections you've saved — PostgreSQL, MySQL, SQL Server.
            A registry for now: nothing in the pipeline loads into these yet.
          </p>
        </div>
        {!adding && (
          <Button onClick={startAdd}>
            <IconPlus />
            Add connection
          </Button>
        )}
      </div>

      {error && <Alert>{error}</Alert>}

      {adding && (
        <Card>
          <CardHeader title={editingId ? "Edit connection" : "New connection"} />
          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap gap-3">
              <FormField label="Name" required>
                <input
                  type="text"
                  placeholder="Reporting warehouse"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  className={inputClass}
                />
              </FormField>
              <FormField label="Kind" required>
                <select
                  value={draft.kind}
                  onChange={(e) => onKindChange(e.target.value as ConnectionKind)}
                  className={inputClass}
                >
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Host" required>
                <input
                  type="text"
                  placeholder="localhost"
                  value={draft.host}
                  onChange={(e) => setDraft((d) => ({ ...d, host: e.target.value }))}
                  className={inputClass}
                />
              </FormField>
              <FormField label="Port" required>
                <input
                  type="number"
                  value={draft.port}
                  onChange={(e) => setDraft((d) => ({ ...d, port: Number(e.target.value) }))}
                  className={inputClass}
                />
              </FormField>
              <FormField label="Database" required>
                <input
                  type="text"
                  placeholder="warehouse"
                  value={draft.database}
                  onChange={(e) => setDraft((d) => ({ ...d, database: e.target.value }))}
                  className={inputClass}
                />
              </FormField>
              <FormField label="Schema (optional)">
                <input
                  type="text"
                  placeholder="public"
                  value={draft.schema_name ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, schema_name: e.target.value }))}
                  className={inputClass}
                />
              </FormField>
              <FormField label="Username" required>
                <input
                  type="text"
                  value={draft.username}
                  onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))}
                  className={inputClass}
                />
              </FormField>
              <FormField
                label={editingId ? "Password (leave blank to keep current)" : "Password"}
                required={!editingId}
              >
                <input
                  type="password"
                  value={draft.password}
                  onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
                  className={inputClass}
                />
              </FormField>
            </div>

            <div className="flex gap-2">
              <Button size="sm" disabled={!canSubmit || saving} onClick={submit}>
                {saving ? "Saving…" : editingId ? "Save changes" : "Save connection"}
              </Button>
              <Button variant="white" size="sm" onClick={cancel}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {connections === null && !error && (
        <p className="text-sm text-foreground-muted">Loading connections…</p>
      )}

      {connections !== null && connections.length === 0 && !adding && (
        <div className="rounded-md border border-dashed border-border bg-surface px-4 py-10 text-center">
          <p className="text-sm text-foreground-muted">
            No connections saved yet. Add one to keep a catalog of the
            RDBMS targets you work with.
          </p>
        </div>
      )}

      {connections !== null && connections.length > 0 && (
        <CollapsibleCard title={`${connections.length} connection${connections.length === 1 ? "" : "s"}`} footer={<Pagination pager={pager} />}>
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 border-b-2 border-border bg-surface-soft text-xs uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Kind</th>
                <th className="px-4 py-3 font-medium">Host</th>
                <th className="px-4 py-3 font-medium">Database</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pager.pageItems.map((c) => {
                const status = statusLabel(c);
                return (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-soft">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-foreground-muted uppercase text-xs">
                      {KINDS.find((k) => k.value === c.kind)?.label ?? c.kind}
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">
                      {c.host}:{c.port}
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">
                      {c.database}
                      {c.schema_name && <span className="text-xs">.{c.schema_name}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={status.className} title={c.last_test_error ?? undefined}>
                        {status.text}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button
                          variant="white"
                          size="sm"
                          disabled={testingId === c.id}
                          onClick={() => runTest(c)}
                        >
                          {testingId === c.id ? "Testing…" : "Test"}
                        </Button>
                        <Button variant="white" size="sm" onClick={() => startEdit(c)}>
                          Edit
                        </Button>
                        <Button
                          variant="white"
                          size="sm"
                          className="border-0 text-foreground-muted hover:text-danger"
                          onClick={() => remove(c)}
                        >
                          Remove
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CollapsibleCard>
      )}
    </div>
  );
}
