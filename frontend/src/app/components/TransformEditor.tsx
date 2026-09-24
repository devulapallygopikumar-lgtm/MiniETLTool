"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  createTransform,
  deleteTransform,
  listDatasets,
  listTransforms,
  type NewTransform,
} from "@/app/lib/api";
import type { Dataset, SchemaColumn, Transform, TransformOp } from "@/app/lib/types";
import { Alert, Button, Card, CardHeader, FormField, IconPlus } from "@/app/components/ui";

interface Props {
  datasetId: string;
  columns: SchemaColumn[];
}

const NEEDS_COLUMN: Record<TransformOp, "existing" | "new" | "none"> = {
  filter: "none",
  dedupe: "none",
  sort: "existing",
  rename: "existing",
  lookup: "none",
  derive: "new",
  cast: "existing",
  mask: "existing",
  fill_default: "existing",
  sequence: "new",
  project: "none",
};

const OPS: { value: TransformOp; label: string }[] = [
  { value: "filter", label: "Filter rows" },
  { value: "dedupe", label: "Remove duplicates" },
  { value: "sort", label: "Sort rows" },
  { value: "rename", label: "Rename column" },
  { value: "lookup", label: "Lookup from another dataset" },
  { value: "derive", label: "Add computed column" },
  { value: "cast", label: "Cast type" },
  { value: "mask", label: "Mask column" },
  { value: "fill_default", label: "Fill nulls with a value" },
  { value: "sequence", label: "Add sequence column" },
  { value: "project", label: "Keep only these columns" },
];

const OP_DESCRIPTIONS: Record<TransformOp, string> = {
  filter: "Drop rows that don't match an expression. Dropped rows are recorded as rejects, not silently discarded.",
  dedupe: "Drop rows that repeat an earlier value in the given column(s), keeping the first occurrence.",
  sort: "Reorder the surviving rows by this column, ascending or descending.",
  rename: "Rename a column. Later transforms in the same run can refer to it by its new name.",
  lookup: "Add columns to each row by matching a value against another dataset's already-loaded rows.",
  derive: "Add a new column whose value is computed from an expression over the row's other columns.",
  cast: "Reparse a column as a declared type (integer/number/date/string). Values that don't fit become null.",
  mask: "Hash (deterministic), redact (fixed replacement), or partially hide a column's value.",
  fill_default: "Replace a null in this column with a fixed value. Validation still sees the original null.",
  sequence: "Add a new column of sequential numbers, assigned in the final row order after sort/filter/dedupe.",
  project: "Keep only the listed columns in the loaded output; drop everything else.",
};

const inputClass = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm";

function emptyDraft(): NewTransform {
  return { column: null, op: "fill_default", args: { value: "" } };
}

function summarize(t: Transform): string {
  switch (t.op) {
    case "filter":
      return `keep rows where ${String(t.args.expr ?? "")}`;
    case "dedupe":
      return `on ${(t.args.columns as string[] | undefined)?.join(", ") ?? ""}`;
    case "sort":
      return `by ${t.column} (${String(t.args.order ?? "asc")})`;
    case "rename":
      return `${t.column} → ${String(t.args.to ?? "")}`;
    case "lookup":
      return `${t.column} from dataset ${String(t.args.source_dataset_id ?? "").slice(0, 8)}…`;
    case "derive":
      return `${t.column} = ${String(t.args.expr ?? "")}`;
    case "cast":
      return `${t.column} as ${String(t.args.type ?? "string")}`;
    case "mask":
      return `${t.column} (${String(t.args.mode ?? "redact")})`;
    case "fill_default":
      return `${t.column} · default "${String(t.args.value ?? "")}"`;
    case "sequence":
      return `${t.column} starting at ${String(t.args.start ?? 1)}`;
    case "project":
      return `${(t.args.keep as string[] | undefined)?.join(", ") ?? ""}`;
    default:
      return "";
  }
}

export function TransformEditor({ datasetId, columns }: Props) {
  const [transforms, setTransforms] = useState<Transform[] | null>(null);
  const [otherDatasets, setOtherDatasets] = useState<Dataset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<NewTransform>(emptyDraft());
  const [saving, setSaving] = useState(false);

  function refresh() {
    listTransforms(datasetId)
      .then(setTransforms)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "Failed to load transforms.")
      );
  }

  useEffect(refresh, [datasetId]);

  useEffect(() => {
    listDatasets()
      .then((all) => setOtherDatasets(all.filter((d) => d.id !== datasetId)))
      .catch(() => {
        // lookup source picker just stays empty; not worth a page-level error
      });
  }, [datasetId]);

  function onOpChange(op: TransformOp) {
    const needs = NEEDS_COLUMN[op];
    setDraft({
      op,
      column: needs === "existing" ? columns[0]?.name ?? null : null,
      args: {},
    });
  }

  function setArg(key: string, value: unknown) {
    setDraft((d) => ({ ...d, args: { ...d.args, [key]: value } }));
  }

  async function submitDraft() {
    setSaving(true);
    setError(null);
    try {
      await createTransform(datasetId, draft);
      setDraft(emptyDraft());
      setAdding(false);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save transform.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(transform: Transform) {
    setTransforms((ts) => (ts ? ts.filter((t) => t.id !== transform.id) : ts));
    try {
      await deleteTransform(datasetId, transform.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete transform.");
      refresh();
    }
  }

  const needsColumn = NEEDS_COLUMN[draft.op];

  return (
    <Card>
      <CardHeader
        title="Transforms"
        actions={
          !adding && (
            <Button variant="white" size="sm" onClick={() => setAdding(true)}>
              <IconPlus />
              Add transform
            </Button>
          )
        }
      />

      <div className="p-4">
        <p className="mb-3 text-xs text-foreground-muted">
          Runs after validation passes, before load, in a fixed order: filter →
          dedupe → sort → rename → lookup → derive → cast → mask → fill
          default → sequence → project. Validation still sees the original
          values — a Mandatory rule still blocks the run even if a
          transform below would have fixed the problem.
        </p>

        {error && (
          <div className="mb-3">
            <Alert>{error}</Alert>
          </div>
        )}

        {transforms === null && (
          <p className="text-xs text-foreground-muted">Loading transforms…</p>
        )}

        {transforms !== null && transforms.length === 0 && !adding && (
          <p className="text-xs text-foreground-muted">
            No transforms yet. Loaded rows use the values exactly as parsed.
          </p>
        )}

        {transforms !== null && transforms.length > 0 && (
          <ul className="mb-3 flex flex-col divide-y divide-border">
            {transforms.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
                <div className="flex-1">
                  <span className="cursor-help font-medium" title={OP_DESCRIPTIONS[t.op]}>
                    {OPS.find((o) => o.value === t.op)?.label ?? t.op}
                  </span>
                  <code className="ml-2 rounded bg-surface-soft px-1.5 py-0.5 text-xs">
                    {summarize(t)}
                  </code>
                </div>
                <Button
                  variant="white"
                  size="sm"
                  className="border-0 !px-0 !py-0 text-foreground-muted hover:bg-transparent hover:text-danger"
                  onClick={() => remove(t)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        {adding && (
          <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-soft p-3">
            <div className="flex flex-wrap gap-3">
              <FormField label="Operation">
                <select
                  value={draft.op}
                  onChange={(e) => onOpChange(e.target.value as TransformOp)}
                  className={inputClass}
                  title={OP_DESCRIPTIONS[draft.op]}
                >
                  {OPS.map((o) => (
                    <option key={o.value} value={o.value} title={OP_DESCRIPTIONS[o.value]}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </FormField>

              {needsColumn === "existing" && (
                <FormField label={draft.op === "rename" ? "Column (current name)" : "Column"}>
                  <select
                    value={draft.column ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, column: e.target.value || null }))}
                    className={inputClass}
                  >
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </FormField>
              )}

              {needsColumn === "new" && (
                <FormField label="New column name">
                  <input
                    type="text"
                    placeholder={draft.op === "sequence" ? "row_num" : "full_name"}
                    value={draft.column ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, column: e.target.value || null }))}
                    className={inputClass}
                  />
                </FormField>
              )}

              {draft.op === "filter" && (
                <FormField label="Keep rows where" className="flex-1">
                  <input
                    type="text"
                    placeholder="status = 'Y'"
                    value={String(draft.args.expr ?? "")}
                    onChange={(e) => setArg("expr", e.target.value)}
                    className={`${inputClass} font-mono`}
                  />
                </FormField>
              )}

              {draft.op === "dedupe" && (
                <FormField label="Columns (comma-separated)" className="flex-1">
                  <input
                    type="text"
                    placeholder="guid, ledger_name"
                    onChange={(e) =>
                      setArg(
                        "columns",
                        e.target.value.split(",").map((c) => c.trim()).filter(Boolean)
                      )
                    }
                    className={inputClass}
                  />
                </FormField>
              )}

              {draft.op === "sort" && (
                <FormField label="Order">
                  <select
                    value={String(draft.args.order ?? "asc")}
                    onChange={(e) => setArg("order", e.target.value)}
                    className={inputClass}
                  >
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                  </select>
                </FormField>
              )}

              {draft.op === "rename" && (
                <FormField label="New name">
                  <input
                    type="text"
                    placeholder="given_name"
                    value={String(draft.args.to ?? "")}
                    onChange={(e) => setArg("to", e.target.value)}
                    className={inputClass}
                  />
                </FormField>
              )}

              {draft.op === "lookup" && (
                <>
                  <FormField label="From dataset">
                    <select
                      value={String(draft.args.source_dataset_id ?? "")}
                      onChange={(e) => setArg("source_dataset_id", e.target.value)}
                      className={inputClass}
                    >
                      <option value="">Select a dataset</option>
                      {otherDatasets.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Match this column">
                    <select
                      value={String(draft.args.match_column ?? "")}
                      onChange={(e) => setArg("match_column", e.target.value)}
                      className={inputClass}
                    >
                      <option value="">Select a column</option>
                      {columns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Against their column (optional, else same name)">
                    <input
                      type="text"
                      placeholder={String(draft.args.match_column ?? "")}
                      onChange={(e) => setArg("source_match_column", e.target.value || undefined)}
                      className={inputClass}
                    />
                  </FormField>
                  <FormField label="Bring in (comma-separated)" className="flex-1">
                    <input
                      type="text"
                      placeholder="group, state"
                      onChange={(e) =>
                        setArg(
                          "select",
                          e.target.value.split(",").map((c) => c.trim()).filter(Boolean)
                        )
                      }
                      className={inputClass}
                    />
                  </FormField>
                  <FormField label="Prefix new columns with">
                    <input
                      type="text"
                      placeholder="lkp_"
                      onChange={(e) => setArg("prefix", e.target.value)}
                      className={inputClass}
                    />
                  </FormField>
                </>
              )}

              {draft.op === "derive" && (
                <FormField label="Expression" className="flex-1">
                  <input
                    type="text"
                    placeholder="first + ' ' + last"
                    value={String(draft.args.expr ?? "")}
                    onChange={(e) => setArg("expr", e.target.value)}
                    className={`${inputClass} font-mono`}
                  />
                </FormField>
              )}

              {draft.op === "cast" && (
                <FormField label="Type">
                  <select
                    value={String(draft.args.type ?? "string")}
                    onChange={(e) => setArg("type", e.target.value)}
                    className={inputClass}
                  >
                    <option value="string">String</option>
                    <option value="integer">Integer</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                  </select>
                </FormField>
              )}

              {draft.op === "mask" && (
                <>
                  <FormField label="Mode">
                    <select
                      value={String(draft.args.mode ?? "redact")}
                      onChange={(e) => setArg("mode", e.target.value)}
                      className={inputClass}
                    >
                      <option value="hash">Hash (deterministic)</option>
                      <option value="redact">Redact (fixed replacement)</option>
                      <option value="partial">Partial (keep last n)</option>
                    </select>
                  </FormField>
                  {draft.args.mode === "redact" && (
                    <FormField label="Replacement">
                      <input
                        type="text"
                        placeholder="***"
                        onChange={(e) => setArg("replacement", e.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                  )}
                  {draft.args.mode === "partial" && (
                    <FormField label="Keep last n characters">
                      <input
                        type="number"
                        placeholder="4"
                        onChange={(e) => setArg("keep", Number(e.target.value))}
                        className={inputClass}
                      />
                    </FormField>
                  )}
                </>
              )}

              {draft.op === "fill_default" && (
                <FormField label="Default value">
                  <input
                    type="text"
                    placeholder="0"
                    value={String(draft.args.value ?? "")}
                    onChange={(e) => setArg("value", e.target.value)}
                    className={inputClass}
                  />
                </FormField>
              )}

              {draft.op === "sequence" && (
                <>
                  <FormField label="Start">
                    <input
                      type="number"
                      value={String(draft.args.start ?? 1)}
                      onChange={(e) => setArg("start", Number(e.target.value))}
                      className={inputClass}
                    />
                  </FormField>
                  <FormField label="Step">
                    <input
                      type="number"
                      value={String(draft.args.step ?? 1)}
                      onChange={(e) => setArg("step", Number(e.target.value))}
                      className={inputClass}
                    />
                  </FormField>
                </>
              )}

              {draft.op === "project" && (
                <FormField label="Columns to keep (comma-separated)" className="flex-1">
                  <input
                    type="text"
                    placeholder="id, amount, full_name"
                    onChange={(e) =>
                      setArg(
                        "keep",
                        e.target.value.split(",").map((c) => c.trim()).filter(Boolean)
                      )
                    }
                    className={inputClass}
                  />
                </FormField>
              )}
            </div>

            <p className="text-xs text-foreground-muted">{OP_DESCRIPTIONS[draft.op]}</p>

            <div className="flex gap-2">
              <Button size="sm" disabled={saving} onClick={submitDraft}>
                {saving ? "Saving…" : "Save transform"}
              </Button>
              <Button
                variant="white"
                size="sm"
                onClick={() => {
                  setAdding(false);
                  setDraft(emptyDraft());
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
