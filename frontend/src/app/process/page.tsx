"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, createDerivedDataset, listDatasets } from "@/app/lib/api";
import { GateBadge } from "@/app/components/GateBadge";
import { StateBadge } from "@/app/components/StateBadge";
import { Alert, Button, Card, CardHeader, CollapsibleCard, FormField, IconPlus, IconX } from "@/app/components/ui";
import type { Dataset, DerivedOp } from "@/app/lib/types";

const inputClass = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm";

const OPS: { value: DerivedOp; label: string }[] = [
  { value: "sort", label: "Sort" },
  { value: "dedupe", label: "Distinct / dedupe" },
  { value: "group_by", label: "Group by / aggregate" },
  { value: "window", label: "Window function" },
  { value: "pivot", label: "Pivot" },
  { value: "unpivot", label: "Unpivot" },
  { value: "join", label: "Join" },
];

const OP_DESCRIPTIONS: Record<DerivedOp, string> = {
  sort: "Reorder a final dataset's rows by one column.",
  dedupe: "Keep one row per distinct combination of the given columns.",
  group_by: "Collapse rows into groups, computing an aggregate (count/sum/avg/min/max) per group.",
  window: "Add a column computed over a window of rows (row number, rank, running sum, etc.) without collapsing rows.",
  pivot: "Turn distinct values of one column into new columns, aggregating a value column into each.",
  unpivot: "Turn several columns into two: a category column and a value column, one row per original column.",
  join: "Combine two final datasets on a matching key column.",
};

const AGG_FUNCS = ["count", "sum", "avg", "min", "max"];
const WINDOW_FUNCS = ["row_number", "rank", "dense_rank", "sum", "avg", "count", "min", "max"];

interface Aggregate {
  function: string;
  column: string;
  as: string;
}

function parseList(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

export default function ProcessPage() {
  const router = useRouter();

  const [allDatasets, setAllDatasets] = useState<Dataset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [op, setOp] = useState<DerivedOp>("group_by");
  const [sourceId, setSourceId] = useState("");
  const [rightId, setRightId] = useState("");

  // op-specific fields
  const [sortColumn, setSortColumn] = useState("");
  const [sortOrder, setSortOrder] = useState("asc");
  const [dedupeColumns, setDedupeColumns] = useState("");
  const [groupBy, setGroupBy] = useState("");
  const [aggregates, setAggregates] = useState<Aggregate[]>([{ function: "count", column: "", as: "" }]);
  const [windowFunc, setWindowFunc] = useState("row_number");
  const [windowColumn, setWindowColumn] = useState("");
  const [windowPartitionBy, setWindowPartitionBy] = useState("");
  const [windowOrderBy, setWindowOrderBy] = useState("");
  const [windowAs, setWindowAs] = useState("");
  const [pivotRowKeys, setPivotRowKeys] = useState("");
  const [pivotColumn, setPivotColumn] = useState("");
  const [pivotValueColumn, setPivotValueColumn] = useState("");
  const [pivotAggregate, setPivotAggregate] = useState("sum");
  const [unpivotRowKeys, setUnpivotRowKeys] = useState("");
  const [unpivotColumns, setUnpivotColumns] = useState("");
  const [unpivotCategoryName, setUnpivotCategoryName] = useState("category");
  const [unpivotValueName, setUnpivotValueName] = useState("value");
  const [joinType, setJoinType] = useState("inner");
  const [leftKey, setLeftKey] = useState("");
  const [rightKey, setRightKey] = useState("");
  const [leftPrefix, setLeftPrefix] = useState("l_");
  const [rightPrefix, setRightPrefix] = useState("r_");

  function refreshDatasets() {
    listDatasets()
      .then(setAllDatasets)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "Failed to load datasets.")
      );
  }

  useEffect(refreshDatasets, []);

  const finalDatasets = useMemo(
    () => (allDatasets ?? []).filter((d) => d.row_count !== null),
    [allDatasets]
  );
  const builtEntities = useMemo(
    () =>
      (allDatasets ?? [])
        .filter((d) => d.format === "derived")
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [allDatasets]
  );
  const source = useMemo(() => finalDatasets.find((d) => d.id === sourceId) ?? null, [finalDatasets, sourceId]);
  const right = useMemo(() => finalDatasets.find((d) => d.id === rightId) ?? null, [finalDatasets, rightId]);
  const sourceColumns = source?.columns ?? [];
  const rightColumns = right?.columns ?? [];

  function addAggregate() {
    setAggregates((a) => [...a, { function: "count", column: "", as: "" }]);
  }

  function updateAggregate(index: number, patch: Partial<Aggregate>) {
    setAggregates((a) => a.map((agg, i) => (i === index ? { ...agg, ...patch } : agg)));
  }

  function removeAggregate(index: number) {
    setAggregates((a) => a.filter((_, i) => i !== index));
  }

  function buildArgs(): Record<string, unknown> | null {
    switch (op) {
      case "sort":
        if (!sortColumn) return null;
        return { column: sortColumn, order: sortOrder };
      case "dedupe": {
        const columns = parseList(dedupeColumns);
        if (columns.length === 0) return null;
        return { columns };
      }
      case "group_by": {
        const group_by = parseList(groupBy);
        const cleanAggregates = aggregates
          .filter((a) => a.function === "count" ? true : Boolean(a.column))
          .map((a) => ({
            function: a.function,
            ...(a.column ? { column: a.column } : {}),
            ...(a.as ? { as: a.as } : {}),
          }));
        if (group_by.length === 0 && cleanAggregates.length === 0) return null;
        return { group_by, aggregates: cleanAggregates };
      }
      case "window": {
        const needsColumn = windowFunc !== "row_number" && windowFunc !== "rank" && windowFunc !== "dense_rank";
        if (needsColumn && !windowColumn) return null;
        return {
          function: windowFunc,
          ...(needsColumn ? { column: windowColumn } : {}),
          partition_by: parseList(windowPartitionBy),
          ...(windowOrderBy ? { order_by: windowOrderBy } : {}),
          ...(windowAs ? { as: windowAs } : {}),
        };
      }
      case "pivot": {
        const row_keys = parseList(pivotRowKeys);
        if (row_keys.length === 0 || !pivotColumn || !pivotValueColumn) return null;
        return { row_keys, pivot_column: pivotColumn, value_column: pivotValueColumn, aggregate: pivotAggregate };
      }
      case "unpivot": {
        const columns = parseList(unpivotColumns);
        if (columns.length === 0) return null;
        return {
          row_keys: parseList(unpivotRowKeys),
          columns,
          category_name: unpivotCategoryName || "category",
          value_name: unpivotValueName || "value",
        };
      }
      case "join":
        if (!rightId || !leftKey || !rightKey) return null;
        return {
          right_dataset_id: rightId,
          join_type: joinType,
          left_key: leftKey,
          right_key: rightKey,
          left_prefix: leftPrefix,
          right_prefix: rightPrefix,
        };
      default:
        return null;
    }
  }

  const args = buildArgs();
  const canSubmit = Boolean(name.trim() && sourceId && args);

  async function submit() {
    if (!args) return;
    setSaving(true);
    setError(null);
    try {
      const dataset = await createDerivedDataset({ name: name.trim(), op, source_dataset_id: sourceId, args });
      router.push(`/datasets/${dataset.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to build the new entity.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Process Data</h1>
        <p className="text-sm text-foreground-muted">
          Build a new dataset from one or two already-loaded final datasets:
          sort, group-by/aggregate, join, distinct/dedupe, window functions,
          pivot/unpivot. The result becomes a brand-new dataset that runs
          through the same rules → transforms → load pipeline as any other.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      {allDatasets !== null && finalDatasets.length === 0 && !error && (
        <div className="rounded-md border border-dashed border-border bg-surface px-4 py-10 text-center">
          <p className="text-sm text-foreground-muted">
            Nothing to process yet — a dataset must have loaded at least once
            before it can be used here. Upload a source and run it first.
          </p>
        </div>
      )}

      {finalDatasets.length > 0 && (
        <Card>
          <CardHeader title="New entity" />
          <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-wrap gap-3">
              <FormField label="Name" required>
                <input
                  type="text"
                  placeholder="Ledgers by Parent"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                />
              </FormField>

              <FormField label="Operation" required>
                <select
                  value={op}
                  onChange={(e) => setOp(e.target.value as DerivedOp)}
                  className={inputClass}
                  title={OP_DESCRIPTIONS[op]}
                >
                  {OPS.map((o) => (
                    <option key={o.value} value={o.value} title={OP_DESCRIPTIONS[o.value]}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Source dataset" required>
                <select
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select a dataset</option>
                  {finalDatasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>

            <p className="text-xs text-foreground-muted">{OP_DESCRIPTIONS[op]}</p>

            {source && (
              <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-soft p-3">
                {op === "sort" && (
                  <div className="flex flex-wrap gap-3">
                    <FormField label="Column" required>
                      <select value={sortColumn} onChange={(e) => setSortColumn(e.target.value)} className={inputClass}>
                        <option value="">Select a column</option>
                        {sourceColumns.map((c) => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Order">
                      <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className={inputClass}>
                        <option value="asc">Ascending</option>
                        <option value="desc">Descending</option>
                      </select>
                    </FormField>
                  </div>
                )}

                {op === "dedupe" && (
                  <FormField label="Distinct on columns (comma-separated)" required className="flex-1">
                    <input
                      type="text"
                      placeholder="guid, ledger_name"
                      value={dedupeColumns}
                      onChange={(e) => setDedupeColumns(e.target.value)}
                      className={inputClass}
                    />
                  </FormField>
                )}

                {op === "group_by" && (
                  <div className="flex flex-col gap-3">
                    <FormField label="Group by columns (comma-separated)">
                      <input
                        type="text"
                        placeholder="parent"
                        value={groupBy}
                        onChange={(e) => setGroupBy(e.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-medium">Aggregates</span>
                      {aggregates.map((agg, i) => (
                        <div key={i} className="flex flex-wrap items-end gap-2">
                          <FormField label="Function">
                            <select
                              value={agg.function}
                              onChange={(e) => updateAggregate(i, { function: e.target.value })}
                              className={inputClass}
                            >
                              {AGG_FUNCS.map((f) => (
                                <option key={f} value={f}>{f}</option>
                              ))}
                            </select>
                          </FormField>
                          <FormField label={agg.function === "count" ? "Column (optional = all rows)" : "Column"}>
                            <select
                              value={agg.column}
                              onChange={(e) => updateAggregate(i, { column: e.target.value })}
                              className={inputClass}
                            >
                              <option value="">{agg.function === "count" ? "(all rows)" : "Select a column"}</option>
                              {sourceColumns.map((c) => (
                                <option key={c.name} value={c.name}>{c.name}</option>
                              ))}
                            </select>
                          </FormField>
                          <FormField label="Output name">
                            <input
                              type="text"
                              placeholder={`${agg.function}_${agg.column || "all"}`}
                              value={agg.as}
                              onChange={(e) => updateAggregate(i, { as: e.target.value })}
                              className={inputClass}
                            />
                          </FormField>
                          <Button
                            variant="white"
                            size="sm"
                            className="border-0 text-foreground-muted hover:text-danger"
                            onClick={() => removeAggregate(i)}
                          >
                            <IconX />
                          </Button>
                        </div>
                      ))}
                      <Button variant="white" size="sm" className="self-start" onClick={addAggregate}>
                        <IconPlus />
                        Add aggregate
                      </Button>
                    </div>
                  </div>
                )}

                {op === "window" && (
                  <div className="flex flex-wrap gap-3">
                    <FormField label="Function" required>
                      <select value={windowFunc} onChange={(e) => setWindowFunc(e.target.value)} className={inputClass}>
                        {WINDOW_FUNCS.map((f) => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                    </FormField>
                    {windowFunc !== "row_number" && windowFunc !== "rank" && windowFunc !== "dense_rank" && (
                      <FormField label="Column" required>
                        <select value={windowColumn} onChange={(e) => setWindowColumn(e.target.value)} className={inputClass}>
                          <option value="">Select a column</option>
                          {sourceColumns.map((c) => (
                            <option key={c.name} value={c.name}>{c.name}</option>
                          ))}
                        </select>
                      </FormField>
                    )}
                    <FormField label="Partition by (comma-separated, optional)">
                      <input
                        type="text"
                        placeholder="parent"
                        value={windowPartitionBy}
                        onChange={(e) => setWindowPartitionBy(e.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField label="Order by (optional)">
                      <select value={windowOrderBy} onChange={(e) => setWindowOrderBy(e.target.value)} className={inputClass}>
                        <option value="">(none)</option>
                        {sourceColumns.map((c) => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Output name">
                      <input
                        type="text"
                        placeholder={windowFunc}
                        value={windowAs}
                        onChange={(e) => setWindowAs(e.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                  </div>
                )}

                {op === "pivot" && (
                  <div className="flex flex-wrap gap-3">
                    <FormField label="Row-key columns (comma-separated)" required>
                      <input
                        type="text"
                        placeholder="parent"
                        value={pivotRowKeys}
                        onChange={(e) => setPivotRowKeys(e.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField label="Pivot column (becomes new columns)" required>
                      <select value={pivotColumn} onChange={(e) => setPivotColumn(e.target.value)} className={inputClass}>
                        <option value="">Select a column</option>
                        {sourceColumns.map((c) => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Value column" required>
                      <select value={pivotValueColumn} onChange={(e) => setPivotValueColumn(e.target.value)} className={inputClass}>
                        <option value="">Select a column</option>
                        {sourceColumns.map((c) => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Aggregate">
                      <select value={pivotAggregate} onChange={(e) => setPivotAggregate(e.target.value)} className={inputClass}>
                        {AGG_FUNCS.map((f) => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                    </FormField>
                  </div>
                )}

                {op === "unpivot" && (
                  <div className="flex flex-wrap gap-3">
                    <FormField label="Row-key columns (comma-separated, optional)">
                      <input
                        type="text"
                        placeholder="name"
                        value={unpivotRowKeys}
                        onChange={(e) => setUnpivotRowKeys(e.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField label="Columns to unpivot (comma-separated)" required className="flex-1">
                      <input
                        type="text"
                        placeholder="state, country"
                        value={unpivotColumns}
                        onChange={(e) => setUnpivotColumns(e.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField label="Category column name">
                      <input
                        type="text"
                        value={unpivotCategoryName}
                        onChange={(e) => setUnpivotCategoryName(e.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField label="Value column name">
                      <input
                        type="text"
                        value={unpivotValueName}
                        onChange={(e) => setUnpivotValueName(e.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                  </div>
                )}

                {op === "join" && (
                  <div className="flex flex-wrap gap-3">
                    <FormField label="Join with dataset" required>
                      <select value={rightId} onChange={(e) => setRightId(e.target.value)} className={inputClass}>
                        <option value="">Select a dataset</option>
                        {finalDatasets.filter((d) => d.id !== sourceId).map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Join type">
                      <select value={joinType} onChange={(e) => setJoinType(e.target.value)} className={inputClass}>
                        <option value="inner">Inner</option>
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                        <option value="full">Full</option>
                      </select>
                    </FormField>
                    <FormField label="Left key (this dataset)" required>
                      <select value={leftKey} onChange={(e) => setLeftKey(e.target.value)} className={inputClass}>
                        <option value="">Select a column</option>
                        {sourceColumns.map((c) => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Right key (joined dataset)" required>
                      <select value={rightKey} onChange={(e) => setRightKey(e.target.value)} className={inputClass} disabled={!right}>
                        <option value="">Select a column</option>
                        {rightColumns.map((c) => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Left column prefix">
                      <input type="text" value={leftPrefix} onChange={(e) => setLeftPrefix(e.target.value)} className={inputClass} />
                    </FormField>
                    <FormField label="Right column prefix">
                      <input type="text" value={rightPrefix} onChange={(e) => setRightPrefix(e.target.value)} className={inputClass} />
                    </FormField>
                  </div>
                )}
              </div>
            )}

            <div>
              <Button disabled={!canSubmit || saving} onClick={submit}>
                {saving ? "Building…" : "Build entity"}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {builtEntities.length > 0 && (
        <CollapsibleCard title={`${builtEntities.length} built entit${builtEntities.length === 1 ? "y" : "ies"}`}>
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 border-b-2 border-border bg-surface-soft text-xs uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Entity</th>
                <th className="px-4 py-3 font-medium">Operation</th>
                <th className="px-4 py-3 font-medium">Rows</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Gate</th>
              </tr>
            </thead>
            <tbody>
              {builtEntities.map((d) => {
                const opValue = d.source_filename.split(" of ")[0];
                const opLabel = OPS.find((o) => o.value === opValue)?.label ?? opValue;
                return (
                  <tr key={d.id} className="border-b border-border last:border-0 hover:bg-surface-soft">
                    <td className="px-4 py-3">
                      <Link href={`/datasets/${d.id}`} className="font-medium text-foreground hover:text-primary">
                        {d.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">{opLabel}</td>
                    <td className="px-4 py-3 text-foreground-muted">{d.row_count ?? "—"}</td>
                    <td className="px-4 py-3">
                      <StateBadge state={d.state} />
                    </td>
                    <td className="px-4 py-3">
                      <GateBadge state={d.gate_state} />
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
