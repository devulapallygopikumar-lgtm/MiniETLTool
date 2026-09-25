"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, createDerivedDataset, listDatasets, previewDataset, previewLoaded } from "@/app/lib/api";
import { GateBadge } from "@/app/components/GateBadge";
import { StateBadge } from "@/app/components/StateBadge";
import { DataGrid } from "@/app/components/DataGrid";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  CollapsibleCard,
  Pagination,
  usePagination,
  FormField,
  IconChevronRight,
  IconPlus,
  IconX,
} from "@/app/components/ui";
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
  join: "Combine this dataset with one or more other final datasets, each on its own matching key column.",
};

const AGG_FUNCS = ["count", "sum", "avg", "min", "max"];
const WINDOW_FUNCS = ["row_number", "rank", "dense_rank", "sum", "avg", "count", "min", "max"];

interface Aggregate {
  function: string;
  column: string;
  as: string;
}

interface JoinSpec {
  rightId: string;
  joinType: string;
  leftKey: string;
  rightKey: string;
  rightPrefix: string;
}

function emptyJoin(): JoinSpec {
  return { rightId: "", joinType: "inner", leftKey: "", rightKey: "", rightPrefix: "" };
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
  const [leftPrefix, setLeftPrefix] = useState("l_");
  const [joins, setJoins] = useState<JoinSpec[]>([emptyJoin()]);

  function refreshDatasets() {
    listDatasets()
      .then(setAllDatasets)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "Failed to load datasets.")
      );
  }

  useEffect(() => {
    refreshDatasets();
    // A dataset can be Run from a different page (its own detail page),
    // in another tab, or via browser back/forward -- none of which
    // remount this page, so a mount-only fetch can go stale (e.g. a
    // just-run entity still showing "not validated" here after it
    // already shows as final on /final). Catch up whenever this tab
    // becomes the active one again.
    function onFocus() {
      if (document.visibilityState === "visible") refreshDatasets();
    }
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

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
  const pager = usePagination(builtEntities);

  // Clicking a built entity shows its grid inline, in this same row --
  // not a navigation to its dataset/Run page. One expanded at a time;
  // rows are cached per entity id so re-toggling doesn't refetch.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [entityRows, setEntityRows] = useState<
    Record<string, Record<string, unknown>[] | "loading" | string>
  >({});

  function toggleEntity(d: Dataset) {
    if (expandedId === d.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(d.id);
    if (d.id in entityRows) return;
    setEntityRows((r) => ({ ...r, [d.id]: "loading" }));
    // Loaded (has row_count): show the real loaded data. Not yet run:
    // fall back to a live preview -- a derived dataset's /preview
    // re-executes its operator spec fresh each call, no Run required.
    const fetcher = d.row_count !== null ? previewLoaded : previewDataset;
    fetcher(d.id, 200)
      .then((rows) => setEntityRows((r) => ({ ...r, [d.id]: rows })))
      .catch((err: unknown) =>
        setEntityRows((r) => ({
          ...r,
          [d.id]: err instanceof ApiError ? err.message : "Failed to load rows.",
        }))
      );
  }
  const source = useMemo(() => finalDatasets.find((d) => d.id === sourceId) ?? null, [finalDatasets, sourceId]);
  const sourceColumns = source?.columns ?? [];

  function addJoin() {
    setJoins((j) => [...j, emptyJoin()]);
  }

  function updateJoin(index: number, patch: Partial<JoinSpec>) {
    setJoins((j) => j.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeJoin(index: number) {
    setJoins((j) => j.filter((_, i) => i !== index));
  }

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
      case "join": {
        if (joins.length === 0) return null;
        if (joins.some((j) => !j.rightId || !j.leftKey || !j.rightKey)) return null;
        return {
          left_prefix: leftPrefix,
          joins: joins.map((j) => ({
            right_dataset_id: j.rightId,
            join_type: j.joinType,
            left_key: j.leftKey,
            right_key: j.rightKey,
            ...(j.rightPrefix ? { right_prefix: j.rightPrefix } : {}),
          })),
        };
      }
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
                  <div className="flex flex-col gap-3">
                    <FormField label="Left column prefix (this dataset, applied once)">
                      <input
                        type="text"
                        value={leftPrefix}
                        onChange={(e) => setLeftPrefix(e.target.value)}
                        className={`${inputClass} max-w-[10rem]`}
                      />
                    </FormField>

                    {joins.map((j, i) => {
                      const jRight = finalDatasets.find((d) => d.id === j.rightId) ?? null;
                      const jRightColumns = jRight?.columns ?? [];
                      return (
                        <div
                          key={i}
                          className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface p-2"
                        >
                          <FormField label={`Join with dataset ${i + 1}`} required>
                            <select
                              value={j.rightId}
                              onChange={(e) => updateJoin(i, { rightId: e.target.value, rightKey: "" })}
                              className={inputClass}
                            >
                              <option value="">Select a dataset</option>
                              {finalDatasets.filter((d) => d.id !== sourceId).map((d) => (
                                <option key={d.id} value={d.id}>{d.name}</option>
                              ))}
                            </select>
                          </FormField>
                          <FormField label="Join type">
                            <select
                              value={j.joinType}
                              onChange={(e) => updateJoin(i, { joinType: e.target.value })}
                              className={inputClass}
                            >
                              <option value="inner">Inner</option>
                              <option value="left">Left</option>
                              <option value="right">Right</option>
                              <option value="full">Full</option>
                            </select>
                          </FormField>
                          <FormField label="Left key (this dataset)" required>
                            <select
                              value={j.leftKey}
                              onChange={(e) => updateJoin(i, { leftKey: e.target.value })}
                              className={inputClass}
                            >
                              <option value="">Select a column</option>
                              {sourceColumns.map((c) => (
                                <option key={c.name} value={c.name}>{c.name}</option>
                              ))}
                            </select>
                          </FormField>
                          <FormField label="Right key" required>
                            <select
                              value={j.rightKey}
                              onChange={(e) => updateJoin(i, { rightKey: e.target.value })}
                              className={inputClass}
                              disabled={!jRight}
                            >
                              <option value="">Select a column</option>
                              {jRightColumns.map((c) => (
                                <option key={c.name} value={c.name}>{c.name}</option>
                              ))}
                            </select>
                          </FormField>
                          <FormField label="Right column prefix">
                            <input
                              type="text"
                              placeholder={`r${i}_`}
                              value={j.rightPrefix}
                              onChange={(e) => updateJoin(i, { rightPrefix: e.target.value })}
                              className={`${inputClass} max-w-[8rem]`}
                            />
                          </FormField>
                          {joins.length > 1 && (
                            <Button
                              variant="white"
                              size="sm"
                              className="border-0 text-foreground-muted hover:text-danger"
                              onClick={() => removeJoin(i)}
                            >
                              <IconX />
                            </Button>
                          )}
                        </div>
                      );
                    })}
                    <Button variant="white" size="sm" className="self-start" onClick={addJoin}>
                      <IconPlus />
                      Add another dataset to join
                    </Button>
                    <p className="text-xs text-foreground-muted">
                      Every join is keyed against this source dataset (a star join) --
                      not against each other. Each joined dataset needs its own column
                      prefix so same-named columns (e.g. every entity has a &quot;guid&quot;)
                      don&apos;t collide in the result.
                    </p>
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
        <CollapsibleCard title={`${builtEntities.length} built entit${builtEntities.length === 1 ? "y" : "ies"}`} footer={<Pagination pager={pager} />}>
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 border-b-2 border-border bg-surface-soft text-xs uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Entity</th>
                <th className="px-4 py-3 font-medium">Operation</th>
                <th className="px-4 py-3 font-medium">Rows</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Validation</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {pager.pageItems.map((d) => {
                const opValue = d.source_filename.split(" of ")[0];
                const opLabel = OPS.find((o) => o.value === opValue)?.label ?? opValue;
                const expanded = expandedId === d.id;
                const rows = entityRows[d.id];
                return (
                  <Fragment key={d.id}>
                    <tr className="border-b border-border last:border-0 hover:bg-surface-soft">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggleEntity(d)}
                          className="flex items-center gap-1.5 font-medium text-foreground hover:text-primary"
                        >
                          <IconChevronRight
                            className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
                          />
                          {d.name}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-foreground-muted">{opLabel}</td>
                      <td className="px-4 py-3 text-foreground-muted">
                        {d.row_count !== null ? (
                          d.row_count.toLocaleString()
                        ) : d.preview_row_count !== null ? (
                          <span title="Computed when this entity was built, from its source at that time -- not yet loaded. Run it to make this the real, final row count.">
                            ~{d.preview_row_count.toLocaleString()}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StateBadge state={d.state} />
                      </td>
                      <td className="px-4 py-3">
                        <GateBadge state={d.gate_state} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/datasets/${d.id}`}
                          className="text-xs font-medium text-foreground-muted hover:text-primary"
                        >
                          Manage →
                        </Link>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-border last:border-0 bg-surface-soft/40">
                        <td colSpan={6} className="px-4 py-3">
                          {rows === "loading" && (
                            <p className="text-xs text-foreground-muted">Loading rows…</p>
                          )}
                          {typeof rows === "string" && rows !== "loading" && (
                            <Alert>{rows}</Alert>
                          )}
                          {Array.isArray(rows) && (
                            <DataGrid
                              rows={rows}
                              columns={d.columns.map((c) => c.name)}
                              title={`${d.name}-preview`}
                            />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </CollapsibleCard>
      )}
    </div>
  );
}
