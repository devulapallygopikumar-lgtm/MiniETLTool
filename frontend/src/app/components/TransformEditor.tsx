"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  createTransform,
  deleteTransform,
  listTransforms,
  type NewTransform,
} from "@/app/lib/api";
import type { SchemaColumn, Transform } from "@/app/lib/types";
import { Alert, Button, Card, CardHeader, FormField, IconPlus } from "@/app/components/ui";

interface Props {
  datasetId: string;
  columns: SchemaColumn[];
}

function emptyDraft(columns: SchemaColumn[]): NewTransform {
  return { column: columns[0]?.name ?? "", op: "fill_default", args: { value: "" } };
}

export function TransformEditor({ datasetId, columns }: Props) {
  const [transforms, setTransforms] = useState<Transform[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<NewTransform>(() => emptyDraft(columns));
  const [saving, setSaving] = useState(false);

  function refresh() {
    listTransforms(datasetId)
      .then(setTransforms)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "Failed to load transforms.")
      );
  }

  useEffect(refresh, [datasetId]);

  async function submitDraft() {
    setSaving(true);
    setError(null);
    try {
      await createTransform(datasetId, draft);
      setDraft(emptyDraft(columns));
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

  return (
    <Card>
      <CardHeader
        title="Transforms"
        actions={
          !adding && (
            <Button variant="white" size="sm" onClick={() => setAdding(true)}>
              <IconPlus />
              Add default value
            </Button>
          )
        }
      />

      <div className="p-4">
        <p className="mb-3 text-xs text-foreground-muted">
          Runs after the gate opens, before load. Validation still sees the
          original values — a Mandatory not_null rule on a column still
          blocks the run even if a transform below would have filled it in.
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
                  <span className="font-medium">Fill nulls</span>
                  <span className="text-foreground-muted"> · {t.column}</span>
                  <code className="ml-2 rounded bg-surface-soft px-1.5 py-0.5 text-xs">
                    {String(t.args.value ?? "")}
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
              <FormField label="Column">
                <select
                  value={draft.column}
                  onChange={(e) => setDraft((d) => ({ ...d, column: e.target.value }))}
                  className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                >
                  {columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Default value">
                <input
                  type="text"
                  placeholder="0"
                  value={String(draft.args.value ?? "")}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, args: { value: e.target.value } }))
                  }
                  className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                />
              </FormField>
            </div>

            <div className="flex gap-2">
              <Button size="sm" disabled={saving} onClick={submitDraft}>
                {saving ? "Saving…" : "Save transform"}
              </Button>
              <Button
                variant="white"
                size="sm"
                onClick={() => {
                  setAdding(false);
                  setDraft(emptyDraft(columns));
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
