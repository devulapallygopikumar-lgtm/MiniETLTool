"use client";

import { Select } from "@/app/components/ui/SearchableSelect";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  deleteTargetMapping,
  listConnections,
  listDatasets,
  listTargetColumns,
  listTargetMappings,
  listTargetTables,
  saveTargetMapping,
} from "@/app/lib/api";
import { useAuth } from "@/app/lib/auth-context";
import { Alert, Breadcrumb, Button, Card, CardBody, CardHeader, SearchableSelect, SortTh, Pagination, usePagination } from "@/app/components/ui";
import type { Connection, Dataset, TargetColumn, TargetMapping, TargetTable } from "@/app/lib/types";

const selectClass = "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm";
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// A "source field" choice that generates the value per row (backend: id_generators.py).
const GEN_PREFIX = "__gen:";
type SeqConfig = { prefix: string; start: number; pad: number };
const DEFAULT_SEQ: SeqConfig = { prefix: "", start: 1, pad: 0 };

// Same formula as the backend's format_sequence_id, for the live example.
const seqExample = (c: SeqConfig, offset: number) => `${c.prefix}${String(c.start + offset).padStart(c.pad, "0")}`;

export default function MappingPage() {
  const { can } = useAuth();
  const canManage = can("mapping:manage");
  const canDelete = can("mapping:delete");

  const [connections, setConnections] = useState<Connection[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [mappings, setMappings] = useState<TargetMapping[]>([]);
  const [includeUploads, setIncludeUploads] = useState(false);

  const [connectionId, setConnectionId] = useState("");
  const [tables, setTables] = useState<TargetTable[] | null>(null);
  const [tableKey, setTableKey] = useState(""); // "schema.table"
  const [datasetId, setDatasetId] = useState("");
  const [columns, setColumns] = useState<TargetColumn[] | null>(null);
  // target column -> source field, or GEN_PREFIX + kind when its value is generated
  const [map, setMap] = useState<Record<string, string>>({});
  const [genCfg, setGenCfg] = useState<Record<string, SeqConfig>>({}); // target column -> sequence settings
  // Table to select once the (re)loaded table list arrives -- set by "Open".
  const pendingTable = useRef<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const columnsPager = usePagination(columns);
  const savedPager = usePagination(mappings);
  const [message, setMessage] = useState<string | null>(null);
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [saving, setSaving] = useState(false);

  function fail(err: unknown, fallback: string) {
    setError(err instanceof ApiError ? err.message : fallback);
  }

  function refreshMappings() {
    listTargetMappings().then(setMappings).catch((e) => fail(e, "Failed to load mappings."));
  }

  useEffect(() => {
    listConnections().then(setConnections).catch((e) => fail(e, "Failed to load connections."));
    listDatasets().then(setDatasets).catch((e) => fail(e, "Failed to load datasets."));
    refreshMappings();
  }, []);

  // Connection picked -> list its tables.
  useEffect(() => {
    setTables(null);
    setTableKey("");
    if (!connectionId) return;
    setLoadingTables(true);
    setError(null);
    listTargetTables(connectionId)
      .then((rows) => {
        setTables(rows);
        if (pendingTable.current) setTableKey(pendingTable.current);
        pendingTable.current = null;
      })
      .catch((e) => fail(e, "Failed to read tables."))
      .finally(() => setLoadingTables(false));
  }, [connectionId]);

  const [schemaName, tableName] = useMemo(() => {
    const i = tableKey.indexOf(".");
    return i < 0 ? ["", ""] : [tableKey.slice(0, i), tableKey.slice(i + 1)];
  }, [tableKey]);

  // Table picked -> its columns.
  useEffect(() => {
    setColumns(null);
    if (!connectionId || !tableKey) return;
    setLoadingColumns(true);
    setError(null);
    listTargetColumns(connectionId, schemaName, tableName)
      .then(setColumns)
      .catch((e) => fail(e, "Failed to read columns."))
      .finally(() => setLoadingColumns(false));
  }, [connectionId, tableKey, schemaName, tableName]);

  const existing = mappings.find(
    (m) =>
      m.dataset_id === datasetId &&
      m.connection_id === connectionId &&
      m.target_schema === schemaName &&
      m.target_table === tableName
  );

  // Columns + entity known -> start from the saved mapping, if any.
  useEffect(() => {
    const next: Record<string, string> = {};
    const cfgs: Record<string, SeqConfig> = {};
    existing?.fields.forEach((f) => {
      if (f.source) next[f.target] = f.source;
      else if (f.generate) {
        next[f.target] = GEN_PREFIX + f.generate.kind;
        cfgs[f.target] = { prefix: f.generate.prefix, start: f.generate.start, pad: f.generate.pad };
      }
    });
    setMap(next);
    setGenCfg(cfgs);
    setMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id, datasetId, tableKey, columns]);

  const entities = datasets.filter((d) => includeUploads || d.format === "derived");
  const dataset = datasets.find((d) => d.id === datasetId);
  const sourceFields = dataset?.columns ?? [];

  const mappedCount = columns ? columns.filter((c) => map[c.name]).length : 0;
  const missingRequired = columns ? columns.filter((c) => c.required && !map[c.name]) : [];
  const usedSources = new Set(Object.values(map));

  function autoMap() {
    if (!columns) return;
    const byName = new Map(sourceFields.map((f) => [norm(f.name), f.name]));
    const next = { ...map };
    for (const c of columns) {
      if (!next[c.name]) {
        const hit = byName.get(norm(c.name));
        if (hit) next[c.name] = hit;
      }
    }
    setMap(next);
  }

  async function save() {
    if (!columns || !dataset) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await saveTargetMapping({
        dataset_id: dataset.id,
        connection_id: connectionId,
        target_schema: schemaName,
        target_table: tableName,
        fields: columns.map((c) => {
          const v = map[c.name] || "";
          if (!v.startsWith(GEN_PREFIX)) return { target: c.name, source: v || null };
          const kind = v.slice(GEN_PREFIX.length) as "uuid" | "sequence";
          const cfg = { ...DEFAULT_SEQ, ...genCfg[c.name] };
          return {
            target: c.name,
            source: null,
            generate: { kind, prefix: cfg.prefix, start: cfg.start, step: 1, pad: cfg.pad },
          };
        }),
      });
      setMessage(`Mapping saved: ${dataset.name} → ${schemaName}.${tableName}.`);
      refreshMappings();
    } catch (err) {
      fail(err, "Failed to save mapping.");
    } finally {
      setSaving(false);
    }
  }

  function open(m: TargetMapping) {
    const key = `${m.target_schema}.${m.target_table}`;
    setDatasetId(m.dataset_id);
    if (m.connection_id === connectionId) {
      setTableKey(key);
    } else {
      pendingTable.current = key; // applied when the new table list loads
      setConnectionId(m.connection_id);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function remove(m: TargetMapping) {
    setError(null);
    try {
      await deleteTargetMapping(m.id);
      refreshMappings();
    } catch (err) {
      fail(err, "Failed to delete mapping.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Breadcrumb items={[{ label: "Mapping" }]} />
        <h1 className="text-xl font-semibold">Mapping</h1>
        <p className="text-sm text-foreground-muted">
          Map the fields of a New Entity onto the columns of a table in a target connection.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}
      {message && <Alert variant="success">{message}</Alert>}

      <Card>
        <CardHeader title="Choose what to map" />
        <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-foreground-muted">
            Target connection
            <Select value={connectionId} onChange={(e) => setConnectionId(e.target.value)} className={selectClass}>
              <option value="">Select…</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.kind}){c.last_test_ok === false ? " — last test failed" : ""}
                </option>
              ))}
            </Select>
            {connections.length === 0 && (
              <span className="font-normal">
                No connections yet.{" "}
                <Link href="/target" className="text-primary hover:text-primary-dark">Add one</Link>.
              </span>
            )}
          </label>

          <div className="flex flex-col gap-1 text-xs font-medium text-foreground-muted">
            Target table
            <SearchableSelect
              value={tableKey}
              onChange={setTableKey}
              disabled={!tables || loadingTables}
              placeholder={loadingTables ? "Loading tables…" : "Select…"}
              options={(tables ?? []).map((t) => {
                const key = `${t.schema_name}.${t.name}`;
                return { value: key, label: key };
              })}
            />
            {tables && tables.length === 0 && <span className="font-normal">No tables visible to this login.</span>}
          </div>

          <label className="flex flex-col gap-1 text-xs font-medium text-foreground-muted">
            New Entity
            <Select value={datasetId} onChange={(e) => setDatasetId(e.target.value)} className={selectClass}>
              <option value="">Select…</option>
              {entities.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <span className="flex items-center gap-1.5 font-normal">
              <input
                type="checkbox"
                checked={includeUploads}
                onChange={(e) => setIncludeUploads(e.target.checked)}
              />
              Include uploaded datasets
            </span>
            {!includeUploads && entities.length === 0 && (
              <span className="font-normal">
                No New Entities yet.{" "}
                <Link href="/process" className="text-primary hover:text-primary-dark">Create one</Link>.
              </span>
            )}
          </label>
        </CardBody>
      </Card>

      {loadingColumns && <p className="text-sm text-foreground-muted">Reading columns…</p>}

      {columns && dataset && (
        <Card>
          <CardHeader
            title={`${dataset.name} → ${schemaName}.${tableName}`}
            actions={
              canManage && (
                <div className="flex gap-2">
                  <Button variant="white" size="sm" onClick={autoMap}>
                    Auto-map by name
                  </Button>
                  <Button variant="white" size="sm" onClick={() => setMap({})}>
                    Clear
                  </Button>
                  <Button size="sm" disabled={saving} onClick={save}>
                    {saving ? "Saving…" : existing ? "Update mapping" : "Save mapping"}
                  </Button>
                </div>
              )
            }
          />
          <div className="flex flex-wrap gap-4 border-b border-border px-4 py-2 text-xs text-foreground-muted">
            <span>
              <span className="font-medium text-foreground">{mappedCount}</span> of {columns.length} target columns mapped
            </span>
            {missingRequired.length > 0 ? (
              <span className="text-danger">
                {missingRequired.length} required column{missingRequired.length === 1 ? "" : "s"} not mapped:{" "}
                {missingRequired.map((c) => c.name).join(", ")}
              </span>
            ) : (
              <span className="text-success">All required columns mapped</span>
            )}
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 border-b-2 border-border bg-surface-soft text-xs uppercase tracking-wide text-foreground-muted">
                <tr>
                  <SortTh pager={columnsPager} col="name" className="px-4 py-2 font-medium">Target column</SortTh>
                  <SortTh pager={columnsPager} col="type" className="px-4 py-2 font-medium">Type</SortTh>
                  <SortTh pager={columnsPager} col="required" className="px-4 py-2 font-medium">Required</SortTh>
                  <SortTh pager={columnsPager} col="source" value={(c) => map[c.name]} className="px-4 py-2 font-medium">Source field ({dataset.name})</SortTh>
                </tr>
              </thead>
              <tbody>
                {columnsPager.pageItems.map((c) => {
                  const src = map[c.name] ?? "";
                  const srcType = sourceFields.find((f) => f.name === src)?.type;
                  return (
                    <tr key={c.name} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-mono text-xs">{c.name}</td>
                      <td className="px-4 py-2 text-xs text-foreground-muted">{c.type}</td>
                      <td className="px-4 py-2 text-xs">
                        {c.required ? (
                          <span className={src ? "text-foreground-muted" : "font-medium text-danger"}>Required</span>
                        ) : (
                          <span className="text-foreground-muted">{c.has_default ? "Has default" : "Optional"}</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <Select
                            value={src}
                            disabled={!canManage}
                            onChange={(e) => setMap((m) => ({ ...m, [c.name]: e.target.value }))}
                            className={`${selectClass} max-w-xs`}
                          >
                            <option value="">— not mapped —</option>
                            <option value={GEN_PREFIX + "uuid"}>ƒ Generate UUID</option>
                            <option value={GEN_PREFIX + "sequence"}>ƒ Generate sequence (1, 2, 3…)</option>
                            {sourceFields.map((f) => (
                              <option key={f.name} value={f.name}>
                                {f.name} ({f.type}){usedSources.has(f.name) && f.name !== src ? " · used" : ""}
                              </option>
                            ))}
                          </Select>
                          {srcType && <span className="text-xs text-foreground-muted">{srcType}</span>}
                          {src === GEN_PREFIX + "uuid" && (
                            <span className="text-xs text-foreground-muted">random, e.g. 3f2b8c1e-9a4d-4e6b-…</span>
                          )}
                          {src === GEN_PREFIX + "sequence" && (() => {
                            const cfg = { ...DEFAULT_SEQ, ...genCfg[c.name] };
                            const set = (patch: Partial<SeqConfig>) =>
                              setGenCfg((g) => ({ ...g, [c.name]: { ...cfg, ...patch } }));
                            const num = "w-16 rounded-md border border-border bg-surface px-1.5 py-1 text-xs";
                            return (
                              <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
                                <input
                                  value={cfg.prefix}
                                  maxLength={32}
                                  placeholder="Prefix"
                                  disabled={!canManage}
                                  onChange={(e) => set({ prefix: e.target.value })}
                                  className="w-20 rounded-md border border-border bg-surface px-1.5 py-1 text-xs"
                                />
                                <label className="flex items-center gap-1">
                                  start
                                  <input
                                    type="number"
                                    min={0}
                                    value={cfg.start}
                                    disabled={!canManage}
                                    onChange={(e) => set({ start: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                                    className={num}
                                  />
                                </label>
                                <label className="flex items-center gap-1">
                                  digits
                                  <input
                                    type="number"
                                    min={0}
                                    max={20}
                                    value={cfg.pad}
                                    disabled={!canManage}
                                    onChange={(e) =>
                                      set({ pad: Math.min(20, Math.max(0, parseInt(e.target.value, 10) || 0)) })
                                    }
                                    className={num}
                                  />
                                </label>
                                <span>e.g. {seqExample(cfg, 0)}, {seqExample(cfg, 1)}, {seqExample(cfg, 2)}</span>
                              </div>
                            );
                          })()}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination pager={columnsPager} className="px-4 py-3" />
        </Card>
      )}

      <Card>
        <CardHeader title={`Saved mappings — ${mappings.length}`} />
        {mappings.length === 0 ? (
          <p className="px-4 py-4 text-sm text-foreground-muted">No mappings saved yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-foreground-muted">
              <tr>
                <SortTh pager={savedPager} col="dataset_name" className="px-4 py-2 font-medium">New Entity</SortTh>
                <SortTh pager={savedPager} col="target" value={(m) => `${m.connection_name} ${m.target_schema}.${m.target_table}`} className="px-4 py-2 font-medium">Target</SortTh>
                <SortTh pager={savedPager} col="mapped" value={(m) => m.fields.filter((f) => f.source || f.generate).length} className="px-4 py-2 font-medium">Fields mapped</SortTh>
                <SortTh pager={savedPager} col="updated_at" className="px-4 py-2 font-medium">Updated</SortTh>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {savedPager.pageItems.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-medium">{m.dataset_name}</td>
                  <td className="px-4 py-2 text-foreground-muted">
                    {m.connection_name} · {m.target_schema}.{m.target_table}
                  </td>
                  <td className="px-4 py-2 text-foreground-muted">
                    {m.fields.filter((f) => f.source || f.generate).length} / {m.fields.length}
                  </td>
                  <td className="px-4 py-2 text-xs text-foreground-muted">{new Date(m.updated_at).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="white" size="sm" onClick={() => open(m)}>
                        Open
                      </Button>
                      {canDelete && (
                        <Button
                          variant="white"
                          size="sm"
                          className="text-foreground-muted hover:text-danger"
                          onClick={() => remove(m)}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination pager={savedPager} className="px-4 py-3" />
      </Card>
    </div>
  );
}
